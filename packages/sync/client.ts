import type { Denicek, PlainNode } from "@mydenicek/core";
import type { SignedEvent, UnsignedEvent } from "@mydenicek/shared-types";
import {
  applySyncResponse,
  createSyncRequest,
  type EncodedHelloMessage,
  type EncodedSyncMessage,
  type EncodedSyncResponse,
} from "./protocol.ts";

/**
 * Produce a canonical JSON string with deterministically sorted object keys.
 * This ensures two peers that construct the same logical document always
 * produce the same hash, regardless of property insertion order.
 */
function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalStringify).join(",") + "]";
  }
  const keys = Object.keys(value).sort();
  const pairs = keys.map((k) =>
    JSON.stringify(k) + ":" +
    canonicalStringify((value as Record<string, unknown>)[k])
  );
  return "{" + pairs.join(",") + "}";
}

/**
 * Compute a SHA-256 hash of a PlainNode for initial document validation.
 * Call this on your initial document BEFORE any edits and pass the result
 * to `SyncClientOptions.initialDocumentHash`.
 *
 * Uses the Web Crypto API (`crypto.subtle.digest`), which is available in
 * both Deno and modern browsers. The input is canonicalized (sorted keys)
 * so that logically identical documents always produce the same hash.
 */
export async function computeDocumentHash(doc: PlainNode): Promise<string> {
  const json = canonicalStringify(doc);
  const data = new TextEncoder().encode(json);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Synchronous hash for use in contexts where async is not possible
 * (e.g. test helpers). Uses the same canonical serialization as the
 * async version but with a simple DJB2 hash.
 * @deprecated Prefer {@link computeDocumentHash} for production use.
 */
export function computeDocumentHashSync(doc: PlainNode): string {
  const json = canonicalStringify(doc);
  let h = 0;
  for (let i = 0; i < json.length; i++) {
    h = ((h << 5) - h + json.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/** Options for creating a {@linkcode SyncClient}. */
export interface SyncClientOptions {
  /** WebSocket URL of the sync server endpoint. */
  url: string;
  /** Room identifier to join. */
  roomId: string;
  /** The local Denicek document to synchronize. */
  document: Denicek;
  /** Interval in ms between automatic sync requests (default `1000`). */
  autoSyncIntervalMs?: number;
  /**
   * Hash of the initial document (before any events). Used to verify all
   * peers in a room share the same starting state. Omit to skip validation.
   */
  initialDocumentHash?: string;
  /**
   * Snapshot of the initial document tree. Sent to the server on first sync
   * to bootstrap the room. If omitted, computed from `document.materialize()`.
   */
  initialDocument?: PlainNode;
  /** Called when remote events are applied to the document. */
  onRemoteChange?: (document: Denicek, response: EncodedSyncResponse) => void;
  /** Called when the WebSocket connection closes (both explicit and unexpected). */
  onDisconnect?: () => void;
  /** Stable peer ID bound to authenticated identity when auth is enabled. */
  authPeerId?: string;
  /** Optional signer used to attach Ed25519 signatures to outbound events. */
  signUnsignedEvent?: (event: UnsignedEvent) => Promise<SignedEvent>;
  /** Optional device GUID used for auth-bound socket identity. */
  authDeviceGuid?: string;
}

/**
 * WebSocket client that synchronizes a local Denicek document
 * with a remote sync server. Connects, exchanges frontiers, and
 * auto-syncs on a configurable interval.
 */
export class SyncClient {
  private readonly url: string;
  private readonly roomId: string;
  private readonly document: Denicek;
  private readonly autoSyncIntervalMs: number;
  private initialDocumentHash: string | null;
  private initialDocument: PlainNode;
  private readonly onRemoteChange?: (
    document: Denicek,
    response: EncodedSyncResponse,
  ) => void;
  private readonly onDisconnect?: () => void;
  private readonly authPeerId?: string;
  private readonly signUnsignedEvent?: (
    event: UnsignedEvent,
  ) => Promise<SignedEvent>;
  private readonly authDeviceGuid?: string;
  private socket: WebSocket | null = null;
  private connecting = false;
  private autoSyncTimer: ReturnType<typeof setInterval> | null = null;
  private knownServerFrontiers: string[] = [];
  private serverBootstrapped = false;
  private _paused = false;
  private pauseBuffer: string[] = [];

  /** Create a sync client with the given options. */
  constructor(options: SyncClientOptions) {
    this.url = this.buildSyncUrl(
      options.url,
      options.roomId,
      options.authPeerId,
      options.authDeviceGuid,
    );
    this.roomId = options.roomId;
    this.document = options.document;
    this.autoSyncIntervalMs = options.autoSyncIntervalMs ?? 1000;
    this.initialDocument = options.initialDocument ??
      options.document.materialize();
    // If caller provided a hash, use it. Otherwise, compute async on first sync.
    this.initialDocumentHash = options.initialDocumentHash ?? null;
    this.onRemoteChange = options.onRemoteChange;
    this.onDisconnect = options.onDisconnect;
    this.authPeerId = options.authPeerId;
    this.signUnsignedEvent = options.signUnsignedEvent;
    this.authDeviceGuid = options.authDeviceGuid;
  }

  /** Whether sync is currently paused. */
  get paused(): boolean {
    return this._paused;
  }

  /**
   * Pause syncing: stop auto-sync and suppress all sends/receives.
   * The WebSocket stays open — no reconnect needed on resume.
   */
  pause(): void {
    this._paused = true;
    this.stopAutoSyncLoop();
  }

  /**
   * Resume syncing after a `pause()`. Replays buffered messages and
   * immediately syncs pending local edits.
   */
  async resume(): Promise<void> {
    if (!this._paused) return;
    this._paused = false;
    for (const msg of this.pauseBuffer) {
      await this.handleSocketMessage(msg);
    }
    this.pauseBuffer = [];
    this.startAutoSyncLoop();
    await this.syncNow();
  }

  /** Build the full WebSocket URL with room query parameter. */
  private buildSyncUrl(
    baseUrl: string,
    roomId: string,
    authPeerId?: string,
    authDeviceGuid?: string,
  ): string {
    const url = new URL(baseUrl);
    url.searchParams.set("room", roomId);
    if (authPeerId) {
      url.searchParams.set("peerId", authPeerId);
    }
    if (authDeviceGuid) {
      url.searchParams.set("deviceGuid", authDeviceGuid);
    }
    return url.toString();
  }

  /** Open a WebSocket connection to the sync server. */
  connect(): Promise<void> {
    if (this._paused || this.socket !== null || this.connecting) {
      return Promise.resolve();
    }
    this.connecting = true;
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      socket.onopen = () => {
        this.connecting = false;
        this.socket = socket;
        this.startAutoSyncLoop();
        resolve();
      };
      socket.onerror = () => {
        this.connecting = false;
        reject(new Error(`Could not connect to sync server '${this.url}'.`));
      };
      socket.onmessage = (event) => this.handleSocketMessage(event.data);
      socket.onclose = () => {
        this.socket = null;
        this.stopAutoSyncLoop();
        this.onDisconnect?.();
      };
    });
  }

  /** Close the WebSocket connection and stop auto-sync. */
  close(): void {
    this.connecting = false;
    this.stopAutoSyncLoop();
    this.socket?.close();
    this.socket = null;
  }

  /** Immediately send a sync request with any pending local events. */
  async syncNow(): Promise<void> {
    if (
      this._paused || this.socket === null ||
      this.socket.readyState !== WebSocket.OPEN
    ) {
      return;
    }
    if (this.initialDocumentHash === null) {
      this.initialDocumentHash = await computeDocumentHash(
        this.initialDocument,
      );
    }
    const request = createSyncRequest(
      this.document,
      this.roomId,
      this.knownServerFrontiers,
      this.initialDocumentHash,
      this.serverBootstrapped ? undefined : this.initialDocument,
    );
    if (this.authPeerId) {
      request.peerId = this.authPeerId;
    }
    if (this.signUnsignedEvent) {
      request.signedEvents = await Promise.all(
        request.events.map((event) =>
          this.signUnsignedEvent!({
            docId: this.roomId,
            author: this.authPeerId ?? this.document.peer,
            payload: event,
            predecessors: event.parents.map((parent) =>
              btoa(`${parent.peer}:${parent.seq}`)
            ),
          })
        ),
      );
    }
    this.socket.send(JSON.stringify(request));
  }

  /** Start the periodic auto-sync timer. */
  private startAutoSyncLoop(): void {
    if (this.autoSyncTimer !== null) {
      return;
    }
    this.autoSyncTimer = setInterval(
      () => this.syncNow(),
      this.autoSyncIntervalMs,
    );
  }

  /** Stop the periodic auto-sync timer. */
  private stopAutoSyncLoop(): void {
    if (this.autoSyncTimer === null) {
      return;
    }
    clearInterval(this.autoSyncTimer);
    this.autoSyncTimer = null;
  }

  /** Dispatch an incoming WebSocket message to the appropriate handler. */
  private async handleSocketMessage(rawMessage: string): Promise<void> {
    if (this._paused) {
      this.pauseBuffer.push(rawMessage);
      return;
    }
    let message: EncodedSyncMessage;
    try {
      message = JSON.parse(rawMessage) as EncodedSyncMessage;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(
        `Could not parse sync message (${reason}): ${rawMessage.slice(0, 200)}`,
      );
      return;
    }
    if (message.type === "hello") {
      this.handleHelloMessage(message);
      return;
    }
    if (message.type === "error") {
      console.error(message.message);
      return;
    }
    const syncResponse = message as EncodedSyncResponse;
    applySyncResponse(this.document, syncResponse);
    this.knownServerFrontiers = syncResponse.frontiers;
    this.serverBootstrapped = true;
    if (syncResponse.compactedDocument !== undefined) {
      this.initialDocument = syncResponse.compactedDocument;
      this.initialDocumentHash = await computeDocumentHash(
        this.initialDocument,
      );
    }
    this.onRemoteChange?.(this.document, syncResponse);
  }

  /** Handle the server hello message by triggering an initial sync. */
  private handleHelloMessage(_message: EncodedHelloMessage): void {
    this.syncNow();
  }
}
