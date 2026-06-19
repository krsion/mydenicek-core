import { BinaryHeap } from "@std/data-structures/binary-heap";
import {
  type Edit,
  ListInsertAtEdit,
  ListRemoveAtEdit,
  NoOpEdit,
} from "./edits.ts";
import { Event } from "./event.ts";
import { EventId } from "./event-id.ts";
import { ListNode, type Node } from "./nodes.ts";
import { VectorClock } from "./vector-clock.ts";

// ── EventGraph ──────────────────────────────────────────────────────

export type MaterializeResult = { doc: Node; conflicts: Node[] };

/**
 * Thrown by {@link EventGraph.ingestEvents} when two events share an
 * `EventId` but carry different payloads (either between the buffer and an
 * incoming batch, or between two events in the same incoming batch).
 *
 * Recovery: callers may drop the offending event from their retry set and
 * use {@link EventGraph.discardBufferedEvent} to remove any buffered copy
 * before re-ingesting. The key of the conflicting event is exposed on the
 * error so sync-layer code can act on it without re-parsing the message.
 */
export class ConflictingEventPayloadError extends Error {
  constructor(readonly key: string) {
    super(`Conflicting payload for event '${key}'.`);
    this.name = "ConflictingEventPayloadError";
  }
}

/** A serializable snapshot of a single event for UI inspection. */
export type EventSnapshot = {
  id: string;
  peer: string;
  seq: number;
  parents: string[];
  editKind: string;
  target: string;
  vectorClock: Record<string, number>;
  editDescription: string;
};

type PendingEventsByKey = Record<string, Event>;
type MissingParentCountsByKey = Record<string, number>;
type ChildKeysByMissingParent = Record<string, string[]>;
type PendingDependencyIndex = {
  missingParentCountsByKey: MissingParentCountsByKey;
  childKeysByMissingParent: ChildKeysByMissingParent;
  readyKeys: string[];
};
// These limits bound pathological remote input. Hitting them already means a
// peer is far outside normal interactive-editing behavior, so rejecting the
// input is safer than letting buffering or replay work grow without bound.
const DEFAULT_MAX_BUFFERED_REMOTE_EVENTS = 10_000;
const DEFAULT_MAX_REPLAY_TRANSFORMATIONS = 10_000;

/** Options for configuring an {@linkcode EventGraph}. */
export interface EventGraphOptions {
  /**
   * When true, skip edit validation during event ingestion.
   * Use for relay servers that only store and forward events
   * without needing to understand edit semantics.
   */
  relayMode?: boolean;
  /**
   * Upper bound on the number of remote events buffered while waiting for
   * missing parents. Defaults to 10_000. Once this limit is exceeded,
   * {@linkcode EventGraph.ingestEvents} throws rather than letting the
   * buffer grow without bound.
   */
  maxBufferedRemoteEvents?: number;
  /**
   * Upper bound on the number of concurrent-transformation steps any single
   * replay resolution may take. Defaults to 10_000. Guards against
   * pathological event graphs.
   */
  maxReplayTransformations?: number;
}

export class EventGraph {
  private initial: Node;
  private events: Map<string, Event[]>;
  private _frontierIds: EventId[];
  private cachedOrder: string[] | null = null;
  /** Cached resolved edits from the last full materialization (same lifetime as cachedOrder). */
  private cachedApplied: { ev: Event; edit: Edit }[] | null = null;
  private bufferedEvents: Event[] = [];
  private readonly relayMode: boolean;
  private readonly maxBufferedRemoteEvents: number;
  private readonly maxReplayTransformations: number;
  /**
   * Cached materialized document that matches `cachedApplied`. Kept alongside
   * so that linear-extension inserts can validate against, and mutate, the
   * current doc in place instead of re-materializing from scratch.
   */
  private cachedDoc: Node | null = null;
  private cachedConflicts: Node[] | null = null;

  constructor(
    initial: Node,
    events?: Map<string, Event[]>,
    frontiers?: EventId[],
    options?: EventGraphOptions,
  ) {
    this.initial = initial;
    this.events = events ?? new Map();
    this._frontierIds = frontiers ?? [];
    this.relayMode = options?.relayMode ?? false;
    this.maxBufferedRemoteEvents = options?.maxBufferedRemoteEvents ??
      DEFAULT_MAX_BUFFERED_REMOTE_EVENTS;
    this.maxReplayTransformations = options?.maxReplayTransformations ??
      DEFAULT_MAX_REPLAY_TRANSFORMATIONS;
  }

  get frontiers(): EventId[] {
    return [...this._frontierIds];
  }

  /** Returns the merged vector clock of all frontier events. */
  frontierClock(): Record<string, number> {
    const merged: Record<string, number> = {};
    for (const fId of this._frontierIds) {
      const ev = this.events.get(fId.format());
      if (!ev) continue;
      for (const [peer, seq] of ev.clock.entryRecords()) {
        merged[peer] = Math.max(merged[peer] ?? -1, seq);
      }
    }
    return merged;
  }

  /** Number of committed events in the graph (excludes buffered out-of-order events). */
  get eventCount(): number {
    let count = 0;
    for (const arr of this.events.values()) count += arr.length;
    return count;
  }

  hasEvent(key: string): boolean {
    const id = EventId.parse(key);
    return this.events.get(id.peer)?.[id.seq] !== undefined;
  }

  getEvent(key: string): Event | undefined {
    const id = EventId.parse(key);
    return this.events.get(id.peer)?.[id.seq];
  }

  /** Fast event lookup by already-decomposed peer + seq. */
  private getEventById(peer: string, seq: number): Event | undefined {
    return this.events.get(peer)?.[seq];
  }

  /** Fast existence check by already-decomposed peer + seq. */
  private hasEventById(peer: string, seq: number): boolean {
    return this.events.get(peer)?.[seq] !== undefined;
  }

  /** Insert an event into the per-peer storage. */
  private storeEvent(event: Event): void {
    const peer = event.id.peer;
    let peerEvents = this.events.get(peer);
    if (!peerEvents) {
      peerEvents = [];
      this.events.set(peer, peerEvents);
    }
    peerEvents[event.id.seq] = event;
  }

  /** Iterate all committed events across all peers. */
  private allEvents(): Event[] {
    const result: Event[] = [];
    for (const arr of this.events.values()) {
      for (const ev of arr) {
        if (ev !== undefined) result.push(ev);
      }
    }
    return result;
  }

  /** Map-like lookup facade for passing to Event.validate(). */
  private get eventLookup(): {
    has(key: string): boolean;
    get(key: string): Event | undefined;
  } {
    return {
      has: (key: string) => this.hasEvent(key),
      get: (key: string) => this.getEvent(key),
    };
  }

  /** Clears all materialization caches. */
  private clearMaterializationCaches(): void {
    this.cachedOrder = null;
    this.cachedApplied = null;
    this.cachedDoc = null;
    this.cachedConflicts = null;
  }

  /**
   * Resolves an event into the edit shape it should replay against the current
   * graph state.
   *
   * The returned edit first reuses the same conflict-resolution path as normal
   * materialization, then it is transformed through every later structural edit
   * that changed the document shape after the source event was recorded. This
   * lets replay follow renamed, wrapped, or reindexed targets instead of using
   * the source event's stale original selectors.
   *
   * Notably, this transformation applies even when the later structural edit
   * was authored by the *same* peer as the source event. A user who records a
   * `set` against `person/name`, then renames `name` to `fullName`, and then
   * replays the original event, will see the replay hit `person/fullName`.
   * Selector rewriting is agnostic to authorship; only the topological order
   * of structural edits matters.
   *
   * Throws when the source event is unknown, already resolves to a conflict, or
   * later structural history has removed the replay target entirely.
   */
  resolveReplayEdit(key: string): Edit {
    const sourceEvent = this.getEvent(key);
    if (sourceEvent === undefined) {
      throw new Error(
        `Unknown event '${key}'. Events must be recorded locally or received before they can be replayed.`,
      );
    }
    const applied = this.ensureCachedApplied();
    let replayEdit: Edit | null = null;
    let replayTransformationCount = 0;
    for (const { ev, edit } of applied) {
      const orderedKey = ev.id.format();
      if (orderedKey === key) {
        if (edit instanceof NoOpEdit) {
          throw new Error(
            `Cannot replay event '${key}' because it currently resolves to a conflict.`,
          );
        }
        replayEdit = edit;
      } else if (
        replayEdit !== null && (edit.isStructural || edit.target.hasWildcard)
      ) {
        replayTransformationCount++;
        if (replayTransformationCount > this.maxReplayTransformations) {
          throw new Error(
            `Cannot replay event '${key}' through more than ${this.maxReplayTransformations} structural transformations.`,
          );
        }
        replayEdit = edit.transformLaterConcurrentEdit(replayEdit);
        if (replayEdit instanceof NoOpEdit) {
          throw new Error(
            `Cannot replay event '${key}' because later structural edits removed its target.`,
          );
        }
      }
    }
    if (replayEdit === null) {
      throw new Error(
        `Unknown event '${key}'. Events must be recorded locally or received before they can be replayed.`,
      );
    }
    return replayEdit;
  }

  // ── Pure op-based CRDT mapping (Baquero et al., 2017) ───────────────
  // In Baquero's terminology:
  //   prepare  ≡  Denicek.add/insert/... (read state, produce Edit)
  //   effect   ≡  insertEvent (add tagged operation to PO-Log)
  //   eval     ≡  materialize (deterministic topological replay)
  // The PO-Log (this.events) is append-only: replay references event
  // IDs that must remain in the DAG, so pruning is not possible.

  insertEvent(event: Event, skipEditValidation = false): void {
    event.validate(this.eventLookup);

    // Track whether this insertion is a strict linear extension of the
    // current state, i.e. event.parents exactly equals this._frontierIds.
    // When it is, we can (a) validate the edit against the cached doc
    // instead of re-materializing from scratch, and (b) extend the cache
    // in place afterwards so the next insert can reuse it. This turns
    // N back-to-back linear inserts (the common case during local editing
    // and live sync) from O(N^2) into amortized O(N).
    const linearExtension = this.isLinearExtension(event);

    // In relay mode we never materialize the document, so we don't need to
    // prime any cache. Skipping this also means the relay never calls edit
    // implementations, so it does not need app-specific primitive edits to
    // be registered.
    if (!this.relayMode && !skipEditValidation) {
      // Prime the cache on first linear extension so subsequent inserts can
      // reuse it. This is cheap because materialize() without frontier would
      // need to run on the very next read anyway.
      if (linearExtension && this.cachedDoc === null) {
        this.materialize();
      }

      if (linearExtension && this.cachedDoc !== null) {
        event.edit.validate(this.cachedDoc);
      } else {
        this.validateEventAgainstCausalState(event);
      }
    } else if (!this.relayMode && linearExtension && this.cachedDoc === null) {
      // Even when skipping edit validation (remote events), prime the cache
      // so the linear extension fast path works.
      this.materialize();
    }

    this.storeEvent(event);

    if (
      !this.relayMode &&
      linearExtension && this.cachedDoc !== null && this.cachedOrder !== null
    ) {
      // In-place extension: the new event is a strict linear extension of
      // the current frontier, so resolveAgainst is a no-op (every prior is
      // a causal ancestor and gets skipped). We can apply directly — but
      // edit.apply() may still throw on some remote events whose default
      // validate() was too permissive (e.g. ApplyPrimitiveEdit against a
      // missing target). In that case the event is a conflict: drop all
      // caches so the next materialize() rebuilds with proper NoOp
      // resolution.
      this._frontierIds = [event.id];
      this.cachedOrder.push(event.id.format());
      if (this.cachedApplied !== null) {
        this.cachedApplied.push({ ev: event, edit: event.edit });
      }
      try {
        event.edit.apply(this.cachedDoc);
      } catch {
        this.clearMaterializationCaches();
      }
      return;
    }

    const parentKeys = new Set(event.parents.map((p) => p.format()));
    this._frontierIds = [
      ...this._frontierIds.filter((h) => !parentKeys.has(h.format())),
      event.id,
    ].sort((a, b) => a.compareTo(b));

    this.clearMaterializationCaches();
  }

  private isLinearExtension(event: Event): boolean {
    if (event.parents.length !== this._frontierIds.length) return false;
    const parentKeys = new Set(event.parents.map((p) => p.format()));
    for (const h of this._frontierIds) {
      if (!parentKeys.has(h.format())) return false;
    }
    return true;
  }

  private validateEventAgainstCausalState(event: Event): void {
    const { doc } = this.materialize(event.parents);
    event.edit.validate(doc);
  }

  /** Creates a new event from a local edit, inserts it, and returns it. */
  createEvent(peer: string, edit: Edit): Event {
    const parents = [...this._frontierIds];
    const clock = new VectorClock();
    for (const p of parents) {
      const parentEvent = this.getEvent(p.format());
      if (parentEvent) clock.merge(parentEvent.clock);
    }
    const seq = clock.tick(peer);
    const event = new Event(new EventId(peer, seq), parents, edit, clock);
    this.insertEvent(event);
    return event;
  }

  private collectPendingEvents(incomingEvents: Event[]): PendingEventsByKey {
    const pendingByKey: PendingEventsByKey = {};
    for (const event of [...this.bufferedEvents, ...incomingEvents]) {
      const key = event.id.format();
      const existing = this.getEvent(key);
      if (existing != null) {
        if (!existing.equals(event)) {
          throw new ConflictingEventPayloadError(key);
        }
        continue;
      }
      const pendingEvent = pendingByKey[key];
      if (pendingEvent !== undefined && !pendingEvent.equals(event)) {
        throw new ConflictingEventPayloadError(key);
      }
      pendingByKey[key] = event;
    }
    return pendingByKey;
  }

  private computePendingDependencyIndex(
    pendingByKey: PendingEventsByKey,
  ): PendingDependencyIndex {
    const missingParentCountsByKey: MissingParentCountsByKey = {};
    const childKeysByMissingParent: ChildKeysByMissingParent = {};
    const readyKeys: string[] = [];

    for (const [key, event] of Object.entries(pendingByKey)) {
      let missingParentCount = 0;
      for (const p of event.parents) {
        const pk = p.format();
        // Parents remain missing until they have actually been inserted into
        // `this.events`; merely being present in `pendingByKey` is not enough
        // to make a child causally ready.
        if (!this.hasEvent(pk)) {
          missingParentCount++;
          (childKeysByMissingParent[pk] ??= []).push(key);
        }
      }
      missingParentCountsByKey[key] = missingParentCount;
      if (missingParentCount === 0) readyKeys.push(key);
    }

    return { missingParentCountsByKey, childKeysByMissingParent, readyKeys };
  }

  private drainReadyEvents(
    pendingByKey: PendingEventsByKey,
    missingParentCountsByKey: MissingParentCountsByKey,
    childKeysByMissingParent: ChildKeysByMissingParent,
    readyKeys: string[],
  ): Event[] {
    while (readyKeys.length > 0) {
      const key = readyKeys.pop()!;
      const event = pendingByKey[key]!;
      this.insertEvent(event, true);
      delete pendingByKey[key];
      const childKeys = childKeysByMissingParent[key];
      if (childKeys != null) {
        for (const childKey of childKeys) {
          const newMissingParentCount = missingParentCountsByKey[childKey]! - 1;
          missingParentCountsByKey[childKey] = newMissingParentCount;
          if (
            newMissingParentCount === 0 && pendingByKey[childKey] !== undefined
          ) {
            readyKeys.push(childKey);
          }
        }
      }
    }

    return Object.values(pendingByKey);
  }

  /** Ingests remote events, buffering out-of-order ones. Returns the current buffer. */
  ingestEvents(incomingEvents: Event[]): Event[] {
    // Stage 1: merge newly received events with the existing buffer, deduplicate
    // by ID, and reject same-ID/different-payload corruption.
    const pendingByKey = this.collectPendingEvents(incomingEvents);
    if (Object.keys(pendingByKey).length === 0) {
      this.bufferedEvents = [];
      return [];
    }

    // Stage 2: for each still-pending event, count how many parents are missing
    // and identify which pending events are already causally ready.
    const { missingParentCountsByKey, childKeysByMissingParent, readyKeys } =
      this.computePendingDependencyIndex(pendingByKey);

    // Stage 3: flush causally ready events, decrementing their dependents until
    // no more buffered events can be inserted in this pass.
    // Anything left still depends on parents we have not seen yet.
    this.bufferedEvents = this.drainReadyEvents(
      pendingByKey,
      missingParentCountsByKey,
      childKeysByMissingParent,
      readyKeys,
    );
    if (this.bufferedEvents.length > this.maxBufferedRemoteEvents) {
      throw new Error(
        `Cannot buffer more than ${this.maxBufferedRemoteEvents} out-of-order remote events.`,
      );
    }
    return [...this.bufferedEvents];
  }

  /**
   * Removes a buffered out-of-order event by its id key, if present.
   *
   * Intended as a recovery hook for sync-layer code that has caught a
   * {@link ConflictingEventPayloadError} or otherwise decided that a
   * specific buffered event is poisoned and will never become applicable.
   * Returns `true` when an event was dropped. Events already inserted into
   * the graph cannot be discarded through this method.
   */
  discardBufferedEvent(key: string): boolean {
    const before = this.bufferedEvents.length;
    this.bufferedEvents = this.bufferedEvents.filter(
      (ev) => ev.id.format() !== key,
    );
    return this.bufferedEvents.length !== before;
  }

  /** Returns events not known by a peer with the given frontiers. */
  eventsSince(remoteFrontiers: EventId[]): Event[] {
    const remoteKnown = this.filterCausalPast(remoteFrontiers, false);
    return this.allEvents().filter(
      (ev) => !remoteKnown.has(ev.id.format()),
    );
  }

  filterCausalPast(frontier: EventId[], strict = true): Set<string> {
    const causalPast = new Set<string>();
    const stack = frontier.map((id) => id.format());
    while (stack.length > 0) {
      const key = stack.pop() as string;
      if (causalPast.has(key)) continue;
      const ev = this.getEvent(key);
      if (ev == null) {
        if (strict) throw new Error(`Unknown version '${key}'.`);
        continue;
      }
      causalPast.add(key);
      for (const p of ev.parents) stack.push(p.format());
    }
    return causalPast;
  }

  /**
   * Computes a deterministic topological order with plain Kahn scheduling.
   *
   * The only tie-break among currently ready nodes is EventId ordering; there
   * are no replay-specific heuristics here. Any semantics that depend on
   * concurrent ordering must therefore be expressed by edit transforms rather
   * than by materialization order.
   */
  computeTopologicalOrder(frontier?: EventId[]): string[] {
    const front = frontier ?? this._frontierIds;
    const causalPast = this.filterCausalPast(front);
    const indegree: Record<string, number> = {};
    const children: Record<string, string[]> = {};
    for (const key of causalPast) {
      indegree[key] = 0;
      children[key] = [];
    }
    for (const key of causalPast) {
      const ev = this.getEvent(key) as Event;
      for (const p of ev.parents) {
        const pk = p.format();
        if (!causalPast.has(pk)) continue;
        indegree[key] = (indegree[key] ?? 0) + 1;
        children[pk]?.push(key);
      }
    }
    const queue = new BinaryHeap<string>((leftKey, rightKey) =>
      (this.getEvent(leftKey) as Event).id.compareTo(
        (this.getEvent(rightKey) as Event).id,
      )
    );
    for (const key of Object.keys(indegree)) {
      if (indegree[key] === 0) queue.push(key);
    }
    const ordered: string[] = [];
    while (queue.length > 0) {
      const key = queue.pop()!;
      ordered.push(key);
      for (const ch of children[key] as string[]) {
        indegree[ch] = (indegree[ch] ?? 0) - 1;
        if (indegree[ch] === 0) queue.push(ch);
      }
    }
    if (ordered.length !== causalPast.size) {
      throw new Error("Event graph contains a cycle.");
    }
    return ordered;
  }

  /**
   * Returns the cached list of resolved edits from a full-frontier
   * materialization. Builds the cache on first call; subsequent calls
   * reuse it until the graph changes (new events invalidate the cache).
   */
  private ensureCachedApplied(): { ev: Event; edit: Edit }[] {
    if (this.cachedApplied !== null) return this.cachedApplied;
    const ordered = this.cachedOrder ??= this.computeTopologicalOrder();

    const doc = this.initial.clone();
    const applied: { ev: Event; edit: Edit }[] = [];

    this.replayEvents(ordered, 0, doc, applied);

    this.cachedApplied = applied;
    this.cachedDoc = doc;
    return applied;
  }

  /**
   * Shared replay loop: iterates events in topological order, resolves
   * against prior edits, handles strict-negative indices, and applies.
   * When `conflicts` is provided, NoOp resolutions are collected into it.
   */
  private replayEvents(
    ordered: string[],
    startIndex: number,
    doc: Node,
    applied: { ev: Event; edit: Edit }[],
    conflicts?: Node[],
  ): void {
    // Build per-peer index from existing applied entries.
    // Maps each peer to its events in sequence order, tagged with topological
    // position. This allows resolveAgainstIndex to skip causal ancestors via
    // O(1) binary search per peer instead of O(N·P) linear scan.
    const peerIndex = new Map<
      string,
      { ev: Event; edit: Edit; topoPos: number }[]
    >();
    for (let i = 0; i < applied.length; i++) {
      const entry = applied[i]!;
      const peer = entry.ev.id.peer;
      let list = peerIndex.get(peer);
      if (!list) {
        list = [];
        peerIndex.set(peer, list);
      }
      list.push({ ev: entry.ev, edit: entry.edit, topoPos: i });
    }

    for (let i = startIndex; i < ordered.length; i++) {
      const key = ordered[i]!;
      const ev = this.getEvent(key) as Event;
      const edit = ev.resolveAgainstIndex(peerIndex, doc);

      if (edit instanceof NoOpEdit) {
        conflicts?.push(edit.toConflict());
        const topoPos = applied.length;
        applied.push({ ev, edit });
        const peer = ev.id.peer;
        let list = peerIndex.get(peer);
        if (!list) {
          list = [];
          peerIndex.set(peer, list);
        }
        list.push({ ev, edit, topoPos });
        continue;
      }

      // Resolve strict-negative indices to absolute positions at replay
      // time — their position depends on the current document state and
      // is not tracked by listLength.  Non-strict negatives carry their
      // own listLength and are resolved by OT via resolveAbsoluteIndex().
      let finalEdit: Edit = edit;
      if (
        (edit instanceof ListInsertAtEdit ||
          edit instanceof ListRemoveAtEdit) &&
        edit.index < 0 && edit.strict
      ) {
        const lists = doc.navigate(edit.target);
        if (lists.length > 0 && lists[0] instanceof ListNode) {
          finalEdit = edit.withResolvedIndex(lists[0].items.length);
        }
      }

      if (
        (finalEdit instanceof ListInsertAtEdit ||
          finalEdit instanceof ListRemoveAtEdit) &&
        !finalEdit.canApply(doc)
      ) {
        const noOp = new NoOpEdit(
          finalEdit.target,
          `Strict edit at stale index is no longer applicable.`,
        );
        conflicts?.push(noOp.toConflict());
        const topoPos = applied.length;
        applied.push({ ev, edit: noOp });
        const peer = ev.id.peer;
        let list = peerIndex.get(peer);
        if (!list) {
          list = [];
          peerIndex.set(peer, list);
        }
        list.push({ ev, edit: noOp, topoPos });
        continue;
      }

      finalEdit.apply(doc);
      const topoPos = applied.length;
      applied.push({ ev, edit: finalEdit });
      const peer = ev.id.peer;
      let list = peerIndex.get(peer);
      if (!list) {
        list = [];
        peerIndex.set(peer, list);
      }
      list.push({ ev, edit: finalEdit, topoPos });
    }
  }

  materialize(frontier?: EventId[]): MaterializeResult {
    if (
      frontier === undefined && this.cachedDoc !== null &&
      this.cachedConflicts !== null
    ) {
      return {
        doc: this.cachedDoc.clone(),
        conflicts: this.cachedConflicts.map((c) => c.clone()),
      };
    }
    const ordered = frontier
      ? this.computeTopologicalOrder(frontier)
      : (this.cachedOrder ??= this.computeTopologicalOrder());

    const doc = this.initial.clone();
    const applied: { ev: Event; edit: Edit }[] = [];

    const conflicts: Node[] = [];
    this.replayEvents(ordered, 0, doc, applied, conflicts);

    if (frontier === undefined) {
      this.cachedDoc = doc.clone();
      this.cachedConflicts = conflicts.map((c) => c.clone());
    }
    return { doc, conflicts };
  }

  /**
   * Compacts the event graph by materializing the current state into a new
   * initial document and discarding all events once the caller confirms the
   * currently acknowledged frontier set.
   *
   * After compaction, the graph has zero events and the current materialized
   * state becomes the new initial document.
   */
  compact(acknowledgedFrontiers: EventId[]): void {
    const expectedFrontiers = [...this._frontierIds].map((eventId) =>
      eventId.format()
    ).sort();
    const providedFrontiers = acknowledgedFrontiers.map((eventId) =>
      eventId.format()
    ).sort();
    if (
      expectedFrontiers.length !== providedFrontiers.length ||
      expectedFrontiers.some((frontier, index) =>
        frontier !== providedFrontiers[index]
      )
    ) {
      throw new Error(
        "Cannot compact with stale frontiers. Pass the current acknowledged frontiers.",
      );
    }
    if (this.bufferedEvents.length > 0) {
      throw new Error(
        "Cannot compact while out-of-order remote events are still buffered.",
      );
    }
    const { doc } = this.materialize();
    this.initial = doc;
    this.events = new Map();
    this._frontierIds = [];
    this.clearMaterializationCaches();
  }

  /** Returns a serializable snapshot of all known events for UI inspection. */
  snapshotEvents(): EventSnapshot[] {
    return this.allEvents().map((ev) => ({
      id: ev.id.format(),
      peer: ev.id.peer,
      seq: ev.id.seq,
      parents: ev.parents.map((p) => p.format()),
      editKind: ev.edit.kind,
      target: ev.edit.target.format(),
      vectorClock: ev.clock.toRecord(),
      editDescription: ev.edit.describe(),
    }));
  }
}
