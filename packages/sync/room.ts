import { Denicek, type PlainNode } from "@mydenicek/core";
import { CausalStabilityTracker, VectorClock } from "@mydenicek/core/internal";
import {
  decodeEvent,
  type EncodedEvent,
  type EncodedSyncRequest,
  type EncodedSyncResponse,
  encodeEvent,
} from "./protocol.ts";
import { collectRemoteEventsSince } from "./internal-events.ts";

/**
 * Server-side room that merges events from all connected peers.
 * Each room maintains its own Denicek instance as the authoritative state.
 *
 * The first client to sync bootstraps the room with its initial document.
 * All subsequent clients must share the same initial document (verified
 * via hash comparison).
 *
 * Supports distributed compaction: once all active peers have acknowledged
 * the same frontier, the room can compact by materializing the document
 * and discarding compacted events. Peers that reconnect after compaction
 * receive the compacted document along with any remaining events.
 */
export class SyncRoom {
  /** Unique room identifier. */
  readonly id: string;
  private roomPeer: Denicek;
  private _initialDocumentHash: string | undefined;
  private _initialDocument: PlainNode | undefined;
  private bootstrapped = false;

  /** Per-peer frontier tracking for distributed compaction. */
  private peerFrontiers: Map<string, string[]> = new Map();
  private lastActivityByPeer: Map<string, number> = new Map();
  private compactedFrontier: string[] | null = null;
  /** Tracks peers that have already received a compacted-reset response. */
  private peersResetAfterCompaction: Set<string> = new Set();

  /**
   * Principled causal stability tracking following Bauwens & Gonzalez Boix
   * ("From Causality to Stability", MPLR 2020). Tracks which events all
   * known peers have observed, enabling stability-based compaction decisions.
   */
  readonly stability: CausalStabilityTracker = new CausalStabilityTracker();

  /** Peers inactive longer than this are excluded from compaction consensus. */
  static readonly PEER_ACTIVITY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
  /** Minimum number of events before compaction is considered worthwhile. */
  static readonly MIN_EVENTS_FOR_COMPACTION = 50;

  /** Create a new room with the given identifier and optional initial doc. */
  constructor(id: string, initialDocument?: PlainNode) {
    this.id = id;
    this._initialDocument = initialDocument;
    this.roomPeer = new Denicek(
      `room-${id.replaceAll(":", "-")}`,
      initialDocument,
      { relayMode: true },
    );
    this.bootstrapped = initialDocument !== undefined;
  }

  /** The initial document for this room, if set. */
  get initialDocument(): PlainNode | undefined {
    return this._initialDocument;
  }

  /** The initial document hash for this room, if set. */
  get initialDocumentHash(): string | undefined {
    return this._initialDocumentHash;
  }

  /** Current frontier event IDs of this room's merged state. */
  get frontiers(): string[] {
    return this.roomPeer.frontiers;
  }

  /** Number of committed events in this room's state. */
  get eventCount(): number {
    return this.roomPeer.eventCount;
  }

  /** Returns a read-only copy of the current peer frontiers. */
  getPeerFrontiers(): ReadonlyMap<string, string[]> {
    return new Map(this.peerFrontiers);
  }

  /** Returns the frontier at which the last compaction occurred, or null. */
  getCompactedFrontier(): string[] | null {
    return this.compactedFrontier;
  }

  /** Ingest encoded events into this room's state. */
  ingestEncodedEvents(events: EncodedEvent[]): void {
    for (const encodedEvent of events) {
      this.roomPeer.applyRemote(decodeEvent(encodedEvent));
    }
  }

  /**
   * Validate the initial document hash and bootstrap the room if needed.
   * The first client with a hash and document sets the room's initial state.
   * Returns an error message if the hash mismatches, or undefined if OK.
   */
  validateAndBootstrap(
    clientHash: string | undefined,
    clientInitialDocument: PlainNode | undefined,
  ): string | undefined {
    if (!clientHash) return undefined;

    if (!this._initialDocumentHash) {
      this._initialDocumentHash = clientHash;
      if (clientInitialDocument && !this.bootstrapped) {
        this._initialDocument = clientInitialDocument;
        this.roomPeer = new Denicek(
          `room-${this.id.replaceAll(":", "-")}`,
          clientInitialDocument,
          { relayMode: true },
        );
        this.bootstrapped = true;
      }
      return undefined;
    }

    if (this._initialDocumentHash !== clientHash) {
      return `Initial document mismatch: room expects '${this._initialDocumentHash}' but client sent '${clientHash}'. All peers must start from the same initial document.`;
    }
    return undefined;
  }

  /** Process a sync request: ingest client events and return missing events. */
  computeSyncResponse(request: EncodedSyncRequest): EncodedSyncResponse {
    const peerId = request.peerId;
    const now = Date.now();

    // Track peer activity
    if (peerId) {
      this.lastActivityByPeer.set(peerId, now);
    }

    // Check if the peer's frontier references compacted events.
    // Skip the check for peers that have already been reset.
    if (
      this.compactedFrontier !== null && peerId &&
      request.frontiers.length > 0 &&
      !this.peersResetAfterCompaction.has(peerId)
    ) {
      const peerReferencesCompactedEvents = request.frontiers.some(
        (f) =>
          !this.roomPeer.frontiers.includes(f) &&
          !this.roomPeerHasEvent(f),
      );
      if (peerReferencesCompactedEvents) {
        // Peer is behind compaction -- send full compacted reset.
        // Don't ingest the peer's events: their parents reference
        // compacted events and would be permanently buffered. The client
        // will re-apply pending local edits against the compacted state
        // and send them in a follow-up sync request.
        const allEvents = collectRemoteEventsSince(this.roomPeer, []).map(
          encodeEvent,
        );

        // Mark this peer as having received the reset
        this.peersResetAfterCompaction.add(peerId);
        this.peerFrontiers.set(peerId, this.roomPeer.frontiers);

        return {
          type: "sync",
          roomId: this.id,
          frontiers: this.roomPeer.frontiers,
          events: allEvents,
          compactedDocument: this._initialDocument!,
        };
      }
    }

    this.ingestEncodedEvents(request.events);

    // Update peer frontier after ingesting their events
    if (peerId) {
      this.peerFrontiers.set(peerId, this.roomPeer.frontiers);

      // Update causal stability tracker with the peer's observation progress.
      // The frontier clock represents the latest causal state this peer knows.
      const clockRecord = this.roomPeer.frontierClock;
      this.stability.updateRemoteClock(
        peerId,
        new VectorClock(clockRecord),
      );
    }

    return {
      type: "sync",
      roomId: this.id,
      frontiers: this.roomPeer.frontiers,
      events: collectRemoteEventsSince(this.roomPeer, request.frontiers).map(
        encodeEvent,
      ),
    };
  }

  /**
   * Checks whether the room's Denicek instance knows about a given event.
   */
  private roomPeerHasEvent(eventKey: string): boolean {
    const allEvents = collectRemoteEventsSince(this.roomPeer, []);
    return allEvents.some((ev) => `${ev.id.peer}:${ev.id.seq}` === eventKey);
  }

  /**
   * Returns peer IDs that have been active within the timeout window.
   * @param now Current timestamp in milliseconds.
   */
  getActivePeers(now: number = Date.now()): string[] {
    const activePeers: string[] = [];
    for (const [peerId, lastActivity] of this.lastActivityByPeer) {
      if (now - lastActivity <= SyncRoom.PEER_ACTIVITY_TIMEOUT_MS) {
        activePeers.push(peerId);
      }
    }
    return activePeers;
  }

  /**
   * Computes the minimum frontier that ALL active peers have acknowledged.
   *
   * Returns null if fewer than 2 active peers exist or if the intersection
   * of their acknowledged event sets is empty.
   */
  computeMinAcknowledgedFrontier(now: number = Date.now()): string[] | null {
    const activePeers = this.getActivePeers(now);
    if (activePeers.length < 2) return null;

    // Collect each active peer's acknowledged frontier
    const peerFrontierSets: string[][] = [];
    for (const peerId of activePeers) {
      const frontier = this.peerFrontiers.get(peerId);
      if (!frontier || frontier.length === 0) return null;
      peerFrontierSets.push(frontier);
    }

    // The room's frontier is the reference -- all peers must have reached it
    const roomFrontiers = this.roomPeer.frontiers;
    if (roomFrontiers.length === 0) return null;

    // All active peers must have acknowledged the same frontier as the room.
    // This is conservative: compaction only triggers when all peers are fully
    // synchronized. A more aggressive approach could compute the causal-past
    // intersection across all peers, allowing compaction of the common prefix
    // even when peers have slightly different frontiers. The conservative
    // approach is chosen for safety — it guarantees no peer loses events that
    // only they have seen.
    const roomFrontierSet = new Set(roomFrontiers);
    for (const peerFrontier of peerFrontierSets) {
      const peerSet = new Set(peerFrontier);
      for (const f of roomFrontierSet) {
        if (!peerSet.has(f)) return null;
      }
    }

    return roomFrontiers;
  }

  /**
   * Attempts to compact the room's event graph.
   *
   * Compaction occurs only when:
   * 1. At least 2 active peers exist
   * 2. All active peers have acknowledged the same frontier
   * 3. The event count exceeds {@link MIN_EVENTS_FOR_COMPACTION}
   *
   * Returns true if compaction was performed.
   */
  tryCompact(now: number = Date.now()): boolean {
    if (this.eventCount < SyncRoom.MIN_EVENTS_FOR_COMPACTION) return false;

    const minFrontier = this.computeMinAcknowledgedFrontier(now);
    if (minFrontier === null) return false;

    // Materialize the current state via a temporary non-relay Denicek,
    // since the room's own Denicek operates in relay mode and may not
    // have all edit implementations available for materialization.
    const tempPeer = new Denicek(
      `compact-${this.id.replaceAll(":", "-")}`,
      this._initialDocument,
    );
    const allEvents = collectRemoteEventsSince(this.roomPeer, []);
    for (const ev of allEvents) {
      tempPeer.applyRemote(ev);
    }
    const compactedDoc = tempPeer.materialize();

    // Replace the room peer with a fresh relay seeded with the compacted state
    this.roomPeer = new Denicek(
      `room-${this.id.replaceAll(":", "-")}`,
      compactedDoc,
      { relayMode: true },
    );

    this.compactedFrontier = minFrontier;
    this._initialDocument = compactedDoc;

    // Clear peer tracking: all peers need to be reset
    for (const peerId of this.peerFrontiers.keys()) {
      this.peerFrontiers.set(peerId, []);
    }
    this.peersResetAfterCompaction.clear();

    return true;
  }

  /** Return all events stored in this room as encoded events. */
  listEncodedEvents(): EncodedEvent[] {
    return collectRemoteEventsSince(this.roomPeer, []).map(encodeEvent);
  }

  /**
   * Notify the room that a peer has disconnected. Removes the peer from
   * the causal stability tracker so that a departed peer does not block
   * stability detection for the remaining active peers.
   */
  peerDisconnected(peerId: string): void {
    this.stability.removePeer(peerId);
  }
}
