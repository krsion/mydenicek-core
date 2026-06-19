import type { VectorClock } from "./vector-clock.ts";
import type { Event } from "./event.ts";

/**
 * Tracks causal stability of events following the principled approach of
 * Bauwens & Gonzalez Boix ("From Causality to Stability", MPLR 2020).
 *
 * An event is **causally stable** when all known peers have observed it —
 * meaning no future concurrent event can arrive that causally precedes it.
 * Stable events can safely have their metadata (vector clocks) pruned and
 * may be candidates for compaction (if not referenced by replay steps).
 *
 * In Baquero's pure op-based CRDT framework, causal stability enables the
 * PO-Log redundancy relation: stable operations whose effect is subsumed
 * by later operations can be removed from the log.
 */
export class CausalStabilityTracker {
  /**
   * Last-known vector clock for each remote peer. Updated when we receive
   * sync messages containing the peer's frontiers (which implicitly
   * communicate their observation progress).
   */
  private remoteClocks: Map<string, Map<string, number>> = new Map();

  /** Set of event IDs that have been determined to be causally stable. */
  private stableEvents: Set<string> = new Set();

  /** Set of event IDs that are referenced by replay steps and must not be pruned. */
  private replayReferences: Set<string> = new Set();

  /**
   * Updates the known observation state for a remote peer.
   * Called when a sync message arrives with the peer's frontiers.
   *
   * @param peerId The remote peer whose state we're updating
   * @param clock The peer's vector clock (derived from their frontier)
   */
  updateRemoteClock(peerId: string, clock: VectorClock): void {
    const existing = this.remoteClocks.get(peerId);
    if (!existing) {
      this.remoteClocks.set(peerId, new Map());
    }
    const peerMap = this.remoteClocks.get(peerId)!;
    // Merge: take component-wise max
    for (const [p, seq] of Object.entries(clock.toRecord())) {
      const current = peerMap.get(p) ?? -1;
      if (seq > current) peerMap.set(p, seq);
    }
  }

  /**
   * Removes tracking state for a peer that has disconnected.
   * After removal, fewer events may be considered stable (conservative).
   */
  removePeer(peerId: string): void {
    this.remoteClocks.delete(peerId);
    // Invalidate stable set — events may no longer be stable
    // without this peer's acknowledgment
    this.stableEvents.clear();
  }

  /**
   * Checks whether an event is causally stable: all known remote peers
   * have observed it (their clock for the event's peer is >= the event's seq).
   *
   * Following Flec's `isCausallyStable`: for each remote peer R, check that
   * R's known clock for the event's originating peer >= the event's seq number.
   */
  isCausallyStable(event: Event): boolean {
    const eventKey = event.id.format();
    if (this.stableEvents.has(eventKey)) return true;

    const eventPeer = event.id.peer;
    const eventSeq = event.id.seq;

    // If no remote peers are known, nothing can be stable
    if (this.remoteClocks.size === 0) return false;

    for (const [_peerId, clockMap] of this.remoteClocks) {
      const knownSeq = clockMap.get(eventPeer) ?? -1;
      if (knownSeq < eventSeq) return false;
    }

    // All peers have observed this event
    this.stableEvents.add(eventKey);
    return true;
  }

  /**
   * Marks an event ID as referenced by a replay step. Referenced events
   * must not be pruned even if causally stable — this is mydenicek's
   * deviation from Baquero's PO-Log pruning (replay needs the full history).
   */
  addReplayReference(eventId: string): void {
    this.replayReferences.add(eventId);
  }

  /**
   * Removes a replay reference (e.g., when a button is deleted).
   */
  removeReplayReference(eventId: string): void {
    this.replayReferences.delete(eventId);
  }

  /**
   * Returns whether an event can be safely pruned from the PO-Log:
   * it must be both causally stable AND not referenced by any replay step.
   *
   * This is the key deviation from Baquero: in the original framework,
   * causal stability alone is sufficient for pruning. In mydenicek,
   * replay references create an additional constraint.
   */
  canPrune(event: Event): boolean {
    return this.isCausallyStable(event) &&
      !this.replayReferences.has(event.id.format());
  }

  /**
   * Returns all events from the given set that can be safely pruned.
   */
  findPrunableEvents(events: Map<string, Event>): Event[] {
    const prunable: Event[] = [];
    for (const event of events.values()) {
      if (this.canPrune(event)) {
        prunable.push(event);
      }
    }
    return prunable;
  }

  /** Number of currently tracked remote peers. */
  get peerCount(): number {
    return this.remoteClocks.size;
  }

  /** Number of events known to be causally stable. */
  get stableCount(): number {
    return this.stableEvents.size;
  }

  /** Number of replay-referenced event IDs. */
  get replayReferenceCount(): number {
    return this.replayReferences.size;
  }
}
