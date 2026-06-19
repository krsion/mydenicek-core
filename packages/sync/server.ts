import type { PlainNode } from "@mydenicek/core";
import type {
  EncodedEvent,
  EncodedHelloMessage,
  EncodedSyncRequest,
} from "./protocol.ts";
import { SyncRoom } from "./room.ts";

/** Persisted room metadata (written once on creation, rewritten on compaction). */
interface PersistedRoomMeta {
  initialDocument?: PlainNode;
  initialDocumentHash?: string;
}

/** Options for {@linkcode createSyncServer}. */
export interface SyncServerOptions {
  /** Port to listen on (default `8787`). */
  port?: number;
  /** Bind address (default `0.0.0.0`). */
  hostname?: string;
  /** URL path for WebSocket upgrades (default `/sync`). */
  path?: string;
  /** Directory for JSON event persistence. Omit for in-memory only. */
  persistencePath?: string;
  /**
   * Maximum number of rooms to keep in memory. When exceeded, the least
   * recently active room with no connected clients is evicted. Evicted rooms
   * remain on disk (if persistence is enabled) and are reloaded on reconnect.
   * Default: no limit.
   */
  maxRooms?: number;
}

/** Handle returned by {@linkcode createSyncServer}. */
export interface SyncServerHandle {
  /** The underlying Deno HTTP server. */
  server: Deno.HttpServer<Deno.NetAddr>;
  /** Gracefully shut down, flushing any pending writes. */
  close(): Promise<void>;
  /**
   * Evict rooms with no connected clients that have been inactive for longer
   * than `ROOM_EVICTION_TIMEOUT_MS`. Exposed for testing; also runs
   * automatically on a periodic interval.
   */
  evictInactiveRooms(): void;
}

type ClientState = {
  roomId: string;
  frontiers: string[];
  /** Whether this client has passed initial document hash validation. */
  hashValidated: boolean;
  /** Peer ID from the first sync message, used for stability tracking on disconnect. */
  peerId?: string;
};

function buildMetaFilePath(persistencePath: string, roomId: string): string {
  return `${persistencePath}/${encodeURIComponent(roomId)}.meta.json`;
}

function buildEventsFilePath(persistencePath: string, roomId: string): string {
  return `${persistencePath}/${encodeURIComponent(roomId)}.events.ndjson`;
}

async function loadRoomFromDisk(
  persistencePath: string,
  roomId: string,
): Promise<SyncRoom> {
  const metaPath = buildMetaFilePath(persistencePath, roomId);
  const eventsPath = buildEventsFilePath(persistencePath, roomId);

  // Try new NDJSON format first
  let meta: PersistedRoomMeta | undefined;
  try {
    meta = JSON.parse(await Deno.readTextFile(metaPath));
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }

  if (meta) {
    const room = new SyncRoom(roomId, meta.initialDocument);
    if (meta.initialDocumentHash) {
      room.validateAndBootstrap(meta.initialDocumentHash, undefined);
    }
    try {
      const eventsText = await Deno.readTextFile(eventsPath);
      for (const line of eventsText.split("\n")) {
        const trimmed = line.trim();
        if (trimmed) room.ingestEncodedEvents([JSON.parse(trimmed)]);
      }
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
    return room;
  }

  // Fall back to legacy single-file format
  const legacyPath = `${persistencePath}/${encodeURIComponent(roomId)}.json`;
  try {
    const data = JSON.parse(await Deno.readTextFile(legacyPath));
    if (Array.isArray(data)) {
      const room = new SyncRoom(roomId);
      room.ingestEncodedEvents(data);
      return room;
    }
    const persisted = data as {
      initialDocument?: PlainNode;
      initialDocumentHash?: string;
      events: EncodedEvent[];
    };
    const room = new SyncRoom(roomId, persisted.initialDocument);
    if (persisted.initialDocumentHash) {
      room.validateAndBootstrap(persisted.initialDocumentHash, undefined);
    }
    room.ingestEncodedEvents(persisted.events);
    return room;
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }

  return new SyncRoom(roomId);
}

async function persistRoomMeta(
  persistencePath: string,
  room: SyncRoom,
): Promise<void> {
  await Deno.mkdir(persistencePath, { recursive: true });
  const metaPath = buildMetaFilePath(persistencePath, room.id);
  const meta: PersistedRoomMeta = {
    initialDocument: room.initialDocument,
    initialDocumentHash: room.initialDocumentHash,
  };
  const tmpPath = `${metaPath}.${crypto.randomUUID()}.tmp`;
  await Deno.writeTextFile(tmpPath, JSON.stringify(meta));
  await Deno.rename(tmpPath, metaPath);
}

async function appendEvents(
  persistencePath: string,
  roomId: string,
  events: EncodedEvent[],
): Promise<void> {
  if (events.length === 0) return;
  await Deno.mkdir(persistencePath, { recursive: true });
  const eventsPath = buildEventsFilePath(persistencePath, roomId);
  const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  await Deno.writeFile(
    eventsPath,
    new TextEncoder().encode(lines),
    { append: true, create: true },
  );
}

/** Create a WebSocket sync server with optional file-based persistence. */
export function createSyncServer(
  options: SyncServerOptions = {},
): SyncServerHandle {
  const port = options.port ?? 8787;
  const hostname = options.hostname ?? "0.0.0.0";
  const path = options.path ?? "/sync";
  const rooms = new Map<string, SyncRoom>();
  const clients = new Map<WebSocket, ClientState>();
  const pendingRoomWrites = new Map<string, Promise<void>>();
  const roomLastActivity = new Map<string, number>();

  const ROOM_EVICTION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
  const EVICTION_INTERVAL_MS = 60_000;

  function getConnectedRoomIds(): Set<string> {
    return new Set([...clients.values()].map((s) => s.roomId));
  }

  function evictInactiveRooms(): void {
    const now = Date.now();
    const connectedRoomIds = getConnectedRoomIds();
    for (const [roomId, lastActivity] of roomLastActivity) {
      if (connectedRoomIds.has(roomId)) continue;
      if (now - lastActivity < ROOM_EVICTION_TIMEOUT_MS) continue;
      if (pendingRoomWrites.has(roomId)) continue;
      rooms.delete(roomId);
      roomLastActivity.delete(roomId);
    }
  }

  function evictLeastRecentlyActiveRoom(): void {
    if (options.maxRooms === undefined) return;
    if (rooms.size <= options.maxRooms) return;
    const connectedRoomIds = getConnectedRoomIds();
    let oldestRoomId: string | undefined;
    let oldestActivity = Infinity;
    for (const [roomId, lastActivity] of roomLastActivity) {
      if (connectedRoomIds.has(roomId)) continue;
      if (pendingRoomWrites.has(roomId)) continue;
      if (lastActivity < oldestActivity) {
        oldestActivity = lastActivity;
        oldestRoomId = roomId;
      }
    }
    if (oldestRoomId !== undefined) {
      rooms.delete(oldestRoomId);
      roomLastActivity.delete(oldestRoomId);
    }
  }

  const evictionInterval = setInterval(
    evictInactiveRooms,
    EVICTION_INTERVAL_MS,
  );

  async function ensureRoomLoaded(roomId: string): Promise<SyncRoom> {
    const existingRoom = rooms.get(roomId);
    if (existingRoom !== undefined) {
      return existingRoom;
    }
    const room = options.persistencePath === undefined
      ? new SyncRoom(roomId)
      : await loadRoomFromDisk(options.persistencePath, roomId);
    rooms.set(roomId, room);
    roomLastActivity.set(roomId, Date.now());
    evictLeastRecentlyActiveRoom();
    return room;
  }

  /** Load a room if it exists in memory or persistence. Returns undefined for new rooms. */
  async function tryLoadRoom(
    roomId: string,
  ): Promise<SyncRoom | undefined> {
    const existing = rooms.get(roomId);
    if (existing) return existing;
    if (!options.persistencePath) return undefined;
    try {
      const room = await loadRoomFromDisk(options.persistencePath, roomId);
      if (room.initialDocument) {
        rooms.set(roomId, room);
        roomLastActivity.set(roomId, Date.now());
        evictLeastRecentlyActiveRoom();
        return room;
      }
    } catch { /* not found */ }
    return undefined;
  }

  function broadcastRoomState(changedSocket: WebSocket, room: SyncRoom): void {
    for (const [socket, state] of clients.entries()) {
      // The originating socket already receives its direct sync response in the
      // request handler below, so broadcasting only forwards the merged state
      // to the other sockets in the same room.
      if (
        socket === changedSocket || state.roomId !== room.id ||
        socket.readyState !== WebSocket.OPEN || !state.hashValidated
      ) {
        continue;
      }
      const response = room.computeSyncResponse({
        type: "sync",
        roomId: room.id,
        frontiers: state.frontiers,
        events: [],
      });
      if (response.events.length === 0) {
        continue;
      }
      socket.send(JSON.stringify(response));
      state.frontiers = response.frontiers;
    }
  }

  function enqueueEventAppend(
    roomId: string,
    newEvents: EncodedEvent[],
  ): Promise<void> {
    if (!options.persistencePath || newEvents.length === 0) {
      return Promise.resolve();
    }
    const prev = pendingRoomWrites.get(roomId) ?? Promise.resolve();
    const next = prev
      .catch(() => undefined)
      .then(() => appendEvents(options.persistencePath!, roomId, newEvents))
      .finally(() => {
        if (pendingRoomWrites.get(roomId) === next) {
          pendingRoomWrites.delete(roomId);
        }
      });
    pendingRoomWrites.set(roomId, next);
    return next;
  }

  const server = Deno.serve({ port, hostname }, (request) => {
    const url = new URL(request.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    };
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (request.method === "GET" && url.pathname === "/healthz") {
      return new Response("ok", { headers: corsHeaders });
    }
    if (request.method !== "GET" || url.pathname !== path) {
      return new Response("Not found", { status: 404 });
    }

    const roomId = url.searchParams.get("room");
    if (roomId === null || roomId.trim() === "") {
      return new Response("Missing room query parameter.", { status: 400 });
    }
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade request.", {
        status: 400,
      });
    }

    const { socket, response } = Deno.upgradeWebSocket(request);

    socket.onopen = async () => {
      clients.set(socket, { roomId, frontiers: [], hashValidated: false });
      const existingRoom = await tryLoadRoom(roomId);
      const helloMessage: EncodedHelloMessage = {
        type: "hello",
        roomId,
        initialDocument: existingRoom?.initialDocument,
      };
      socket.send(JSON.stringify(helloMessage));
    };

    socket.onmessage = async (event) => {
      try {
        const message = JSON.parse(String(event.data)) as EncodedSyncRequest;
        if (message.type !== "sync") {
          throw new Error(
            `Unsupported sync message type '${
              String((message as { type?: string }).type)
            }'.`,
          );
        }
        const clientState = clients.get(socket);
        const clientRoomId = clientState?.roomId ?? roomId;
        if (message.roomId !== clientRoomId) {
          throw new Error(
            `Socket for room '${clientRoomId}' cannot sync room '${message.roomId}'.`,
          );
        }
        const room = await ensureRoomLoaded(clientRoomId);
        roomLastActivity.set(room.id, Date.now());
        const hadHash = room.initialDocumentHash !== undefined;
        const hashError = room.validateAndBootstrap(
          message.initialDocumentHash,
          message.initialDocument,
        );
        if (hashError) {
          socket.send(JSON.stringify({
            type: "error",
            roomId: clientRoomId,
            message: hashError,
          }));
          return;
        }
        // Persist meta when hash is set for the first time
        if (!hadHash && room.initialDocumentHash && options.persistencePath) {
          await persistRoomMeta(options.persistencePath, room);
        }
        if (clientState !== undefined) {
          clientState.hashValidated = true;
        }
        const responseMessage = room.computeSyncResponse({
          ...message,
          roomId: clientRoomId,
        });
        if (clientState !== undefined) {
          clientState.roomId = room.id;
          clientState.frontiers = responseMessage.frontiers;
          if (message.peerId && !clientState.peerId) {
            clientState.peerId = message.peerId;
          }
        }
        socket.send(JSON.stringify(responseMessage));
        enqueueEventAppend(clientRoomId, message.events);
        broadcastRoomState(socket, room);
      } catch (error) {
        socket.send(JSON.stringify({
          type: "error",
          roomId,
          message: error instanceof Error ? error.message : String(error),
        }));
      }
    };

    socket.onclose = async () => {
      const state = clients.get(socket);
      if (state?.peerId && state.roomId) {
        try {
          const room = await ensureRoomLoaded(state.roomId);
          room.peerDisconnected(state.peerId);
        } catch { /* room may have been evicted */ }
      }
      clients.delete(socket);
    };

    return response;
  });

  return {
    server,
    evictInactiveRooms,
    close: async () => {
      clearInterval(evictionInterval);
      await server.shutdown();
      if (options.persistencePath !== undefined && pendingRoomWrites.size > 0) {
        const writes = Array.from(pendingRoomWrites.values());
        try {
          await Promise.all(writes);
        } catch (error) {
          console.error(
            "Error while flushing pending room writes during server close:",
            error,
          );
        }
      }
    },
  };
}
