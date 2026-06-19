import {
  ApplyPrimitiveEdit,
  CopyEdit,
  type Edit,
  ListInsertAtEdit,
  ListRemoveAtEdit,
  ListReorderEdit,
  RecordAddEdit,
  RecordDeleteEdit,
  RecordRenameFieldEdit,
  UpdateTagEdit,
  WrapListEdit,
  WrapRecordEdit,
} from "./edits.ts";
import type { Event } from "./event.ts";
import { EventGraph, type EventSnapshot } from "./event-graph.ts";
import { EventId } from "./event-id.ts";
import {
  ListNode,
  Node,
  type PlainNode,
  PrimitiveNode,
  RecordNode,
} from "./nodes.ts";
import { validatePeerId } from "./peer-id.ts";
import {
  type PrimitiveEditImplementation,
  registerPrimitiveEdit,
} from "./primitive-edits.ts";
import {
  type PrimitiveValue,
  Selector,
  validateFieldName,
} from "./selector.ts";
import {
  decodeRemoteEvent,
  type EncodedRemoteEvent,
  encodeRemoteEvent,
} from "./remote-events.ts";
import { evaluateAllFormulasOnNode, FormulaError } from "./formula-engine.ts";
import type { FormulaResult } from "./formula-engine.ts";

// ── Denicek (collaborative document peer) ───────────────────────────

/** Options for configuring a {@linkcode Denicek} instance. */
export interface DenicekOptions {
  /**
   * When true, skip edit validation during event ingestion.
   * Intended for relay servers that store and forward events
   * without needing custom edit implementations.
   */
  relayMode?: boolean;
}

/**
 * A collaborative document scoped to a single peer.
 *
 * Manages its own event DAG internally: local edits produce events
 * (retrievable via {@link drain}), remote events are ingested via
 * {@link applyRemote}, and the document is reconstructed via {@link materialize}.
 */
export class Denicek {
  /** Stable identifier of the local peer that produces events. */
  readonly peer: string;
  private graph: EventGraph;
  private pendingEvents: Event[] = [];
  private cachedDoc: Node | null = null;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private isUndoRedoCommit = false;

  /** Creates a peer with an optional initial plain document tree. */
  constructor(peer: string, initial?: PlainNode, options?: DenicekOptions);
  constructor(peer: string, arg?: PlainNode, options?: DenicekOptions) {
    validatePeerId(peer);
    this.peer = peer;
    this.graph = new EventGraph(
      Node.fromPlain(arg ?? { $tag: "root" }),
      undefined,
      undefined,
      { relayMode: options?.relayMode },
    );
  }

  /** Registers a named primitive edit implementation used by local and remote replay. */
  static registerPrimitiveEdit(
    name: string,
    implementation: PrimitiveEditImplementation,
  ): void {
    registerPrimitiveEdit(name, implementation);
  }

  /**
   * Applies a validated local edit, records the resulting event, and returns its id.
   *
   * The returned string is the formatted stable event identifier (`${peer}:${seq}`)
   * assigned to the newly created local event. It can later be passed to
   * {@link replayEditFromEventId}, {@link repeatEditFromEventId}, or persisted
   * in application data.
   *
   * **Threading assumption.** This method is synchronous and assumes single-threaded
   * execution (Deno / browser event loop). The cached document (`cachedDoc`) is read
   * and written within a single synchronous call, so no interleaving with
   * {@link applyRemote} is possible as long as both callers are on the same thread.
   * If this assumption is ever relaxed (e.g. Web Workers sharing a `Denicek`),
   * the cache must be protected by a lock or made immutable-snapshot-based.
   */
  /**
   * Applies a validated local edit: Baquero's *prepare* (read state,
   * create tagged operation) and *effect* (`insertEvent`) in one step.
   * Returns the formatted event ID.
   */
  private commit(edit: Edit): string {
    const doc = this.currentDoc();
    try {
      edit.apply(doc);
      const event = this.graph.createEvent(this.peer, edit);
      this.pendingEvents.push(event);
      if (!this.isUndoRedoCommit) {
        this.undoStack.push(event.id.format());
        this.redoStack = [];
      }
      this.cachedDoc = doc;
      return event.id.format();
    } catch (e) {
      // Failed local edits must be side-effect-free from the caller's point of
      // view: they must not record events and must not keep a partially mutated
      // cached document alive for future operations.
      this.cachedDoc = null;
      throw e;
    }
  }

  /** Whether there is a local edit that can be undone. */
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /** Whether a previously undone edit can be redone. */
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * Undoes the most recent local edit by appending its inverse to the DAG.
   *
   * The inverse is computed against the document state just before the
   * original edit was applied (materialized at the event's parent frontier).
   * The resulting inverse event is a regular DAG event, so remote peers
   * converge on the same undone state automatically.
   *
   * Returns the formatted event id of the newly created inverse event.
   */
  undo(): string {
    if (this.undoStack.length === 0) {
      throw new Error("Nothing to undo.");
    }
    const eventId = this.undoStack.pop()!;
    const event = this.graph.getEvent(eventId);
    if (event === undefined) {
      throw new Error(`Cannot undo unknown event '${eventId}'.`);
    }

    const { doc: preDoc } = this.graph.materialize(event.parents);

    const inverseEdit = event.edit.computeInverse(preDoc);

    this.isUndoRedoCommit = true;
    try {
      const inverseEventId = this.commit(inverseEdit);
      this.redoStack.push(eventId);
      return inverseEventId;
    } finally {
      this.isUndoRedoCommit = false;
    }
  }

  /**
   * Redoes the most recently undone edit by replaying it from the event DAG.
   *
   * Returns the formatted event id of the newly created redo event.
   */
  redo(): string {
    if (this.redoStack.length === 0) {
      throw new Error("Nothing to redo.");
    }
    const eventId = this.redoStack.pop()!;
    const event = this.graph.getEvent(eventId);
    if (event === undefined) {
      throw new Error(`Cannot redo unknown event '${eventId}'.`);
    }

    this.isUndoRedoCommit = true;
    try {
      const redoEventId = this.commit(event.edit);
      this.undoStack.push(eventId);
      return redoEventId;
    } finally {
      this.isUndoRedoCommit = false;
    }
  }

  /** Returns and clears opaque event payloads produced by local edits since the last drain. */
  drain(): EncodedRemoteEvent[] {
    const events = this.pendingEvents;
    this.pendingEvents = [];
    return events.map(encodeRemoteEvent);
  }

  /** Returns the current frontier as formatted event id strings. */
  get frontiers(): string[] {
    return this.graph.frontiers.map((eventId) => eventId.format());
  }

  /**
   * Returns the merged vector clock of all frontier events.
   * This represents the latest causal state known to this replica —
   * useful for communicating observation progress in the causal
   * stability protocol (Bauwens & Gonzalez Boix, MPLR 2020).
   */
  get frontierClock(): Record<string, number> {
    return this.graph.frontierClock();
  }

  /** Number of committed events in the underlying graph. */
  get eventCount(): number {
    return this.graph.eventCount;
  }

  /** Returns opaque event payloads unknown to a peer with the given frontier strings. */
  eventsSince(remoteFrontiers: string[]): EncodedRemoteEvent[] {
    return this.graph.eventsSince(
      remoteFrontiers.map((frontier) => EventId.parse(frontier)),
    ).map(encodeRemoteEvent);
  }

  /**
   * Ingests an opaque event payload produced by another peer. Buffers out-of-order events.
   *
   * **Threading assumption.** Invalidates `cachedDoc` unconditionally. Safe because
   * Deno is single-threaded: no concurrent `commit()` can observe a stale cache
   * between `ingestEvents` and the cache reset.
   */
  applyRemote(event: EncodedRemoteEvent): void {
    this.graph.ingestEvents([decodeRemoteEvent(event)]);
    this.cachedDoc = null;
  }

  /**
   * Adds a named field to every record matched by `target`.
   *
   * Returns the formatted id (`${peer}:${seq}`) of the recorded local event.
   */
  add(target: string, field: string, value: PlainNode): string {
    validateFieldName(field);
    this.validateLocalAddTarget(target, field);
    const path = target === "" ? field : `${target}/${field}`;
    return this.commit(
      new RecordAddEdit(Selector.parse(path), Node.fromPlain(value)),
    );
  }

  /**
   * Deletes a named field from every record matched by `target`.
   *
   * Returns the formatted id (`${peer}:${seq}`) of the recorded local event.
   */
  delete(target: string, field: string): string {
    validateFieldName(field);
    const path = target === "" ? field : `${target}/${field}`;
    return this.commit(new RecordDeleteEdit(Selector.parse(path)));
  }

  /**
   * Renames a field on every record matched by `target`.
   *
   * Returns the formatted id (`${peer}:${seq}`) of the recorded local event.
   */
  rename(target: string, from: string, to: string): string {
    validateFieldName(from);
    validateFieldName(to);
    this.validateLocalRenameTarget(target, from, to);
    const path = target === "" ? from : `${target}/${from}`;
    return this.commit(new RecordRenameFieldEdit(Selector.parse(path), to));
  }

  /**
   * Replaces every primitive node matched by `target` with `value`.
   *
   * Returns the formatted id (`${peer}:${seq}`) of the recorded local event.
   */
  set(target: string, value: PrimitiveValue): string {
    return this.commit(
      new ApplyPrimitiveEdit(Selector.parse(target), "set", [value]),
    );
  }

  /**
   * Returns the plain nodes matched by `target` in the current materialized document.
   *
   * Missing paths return an empty array, while wildcard selectors naturally return
   * multiple concrete matches. Callers can pick one match or iterate all of them
   * without converting the whole document to plain first.
   */
  get(target: string): PlainNode[] {
    const doc = this.currentDoc();
    return doc.navigate(Selector.parse(target)).map((node) =>
      node.toPlain() as PlainNode
    );
  }

  /**
   * Applies a registered named primitive edit to every primitive node matched by `target`.
   * Additional primitive arguments are serialized with the event and passed back
   * to the registered implementation during replay.
   *
   * Returns the formatted id (`${peer}:${seq}`) of the recorded local event.
   */
  applyPrimitiveEdit(
    target: string,
    editName: string,
    ...args: PrimitiveValue[]
  ): string {
    return this.commit(
      new ApplyPrimitiveEdit(Selector.parse(target), editName, args),
    );
  }

  /**
   * Replays the edit carried by an existing event onto a different target.
   *
   * This is the explicit retargeting variant: callers choose both the source
   * event id and the new target selector. It reuses the stored edit through
   * `Edit.withTarget(...)`, so callers should use it only when replaying that
   * edit against a different selector is the behavior they want and the new
   * selector is compatible with that edit kind. In practice that means the
   * target must resolve to the same kind of nodes the original edit expects,
   * such as replaying a primitive edit onto primitive nodes or a list edit
   * onto list nodes. Use {@link repeatEditFromEventId} when you want the same
   * event to follow later wraps, renames, or reindexing automatically instead
   * of choosing a new selector yourself.
   * Returns the formatted id (`${peer}:${seq}`) of the newly recorded replay event.
   */
  replayEditFromEventId(eventId: string, target: string): string {
    const edit = this.resolveReplaySourceEdit(eventId);
    return this.commit(edit.withTarget(Selector.parse(target)));
  }

  /**
   * Replays the edit carried by an existing event at its original target.
   *
   * This is the simplest replay path when the caller wants to repeat the
   * recorded edit semantics without choosing a new selector manually. Unlike
   * {@link replayEditFromEventId}, this keeps the source event's own selector
   * intent and retargets it through later structural history before replaying.
   * Returns the formatted id (`${peer}:${seq}`) of the newly recorded replay event.
   */
  repeatEditFromEventId(eventId: string): string {
    return this.commit(this.resolveReplaySourceEdit(eventId));
  }

  /**
   * Repeats every recorded step stored in the matched replay-step lists.
   *
   * Each matched node must be a list whose items are records containing a string
   * `eventId` field. Steps are read in list order and replayed through the same
   * repeat-edit semantics as {@link repeatEditFromEventId}.
   *
   * All source edits are resolved before any are committed, so multi-step
   * structural recipes (such as wrap + rename + add) replay correctly: each
   * step's selector is retargeted through the graph's structural history
   * without being affected by the other replayed steps in the batch.
   *
   * Returns the formatted ids of the newly recorded replay events.
   */
  repeatEditsFrom(target: string): string[] {
    const edits = this.collectRepeatEditEventIds(target).map((eventId) =>
      this.resolveReplaySourceEdit(eventId)
    );
    return edits.map((edit) => this.commit(edit));
  }

  /**
   * Inserts `value` at `index` in every list matched by `target`.
   *
   * When `strict` is true the operation uses strict boundary semantics
   * (index 0 = front, -1 = back) matching the old pushFront/pushBack behavior.
   *
   * Returns the formatted id (`${peer}:${seq}`) of the recorded local event.
   */
  insert(
    target: string,
    index: number,
    value: PlainNode,
    strict?: boolean,
  ): string {
    const sel = Selector.parse(target);
    const doc = this.currentDoc();
    return this.commit(
      ListInsertAtEdit.create(sel, index, Node.fromPlain(value), doc, strict),
    );
  }

  /**
   * Removes the item at `index` from every list matched by `target`.
   *
   * When `strict` is true the operation uses strict boundary semantics
   * (index 0 = front, -1 = back) matching the old popFront/popBack behavior.
   *
   * Returns the formatted id (`${peer}:${seq}`) of the recorded local event.
   */
  remove(target: string, index: number, strict?: boolean): string {
    const sel = Selector.parse(target);
    const doc = this.currentDoc();
    return this.commit(
      ListRemoveAtEdit.create(sel, index, doc, strict),
    );
  }

  /**
   * Moves an item from `fromIndex` to `toIndex` in every list matched by `target`.
   * The `toIndex` is the target position after the item has been removed from `fromIndex`.
   *
   * Returns the formatted id (`${peer}:${seq}`) of the recorded local event.
   */
  reorder(target: string, fromIndex: number, toIndex: number): string {
    return this.commit(
      new ListReorderEdit(Selector.parse(target), fromIndex, toIndex),
    );
  }

  /**
   * Updates the structural tag on every matched record or list node.
   *
   * Returns the formatted id (`${peer}:${seq}`) of the recorded local event.
   */
  updateTag(target: string, tag: string): string {
    return this.commit(new UpdateTagEdit(Selector.parse(target), tag));
  }

  /**
   * Wraps every node matched by `target` in a record with the given field and tag.
   *
   * Returns the formatted id (`${peer}:${seq}`) of the recorded local event.
   */
  wrapRecord(target: string, field: string, tag: string): string {
    validateFieldName(field);
    return this.commit(new WrapRecordEdit(Selector.parse(target), field, tag));
  }

  /**
   * Wraps every node matched by `target` in a single-item list with the given tag.
   *
   * Returns the formatted id (`${peer}:${seq}`) of the recorded local event.
   */
  wrapList(target: string, tag: string): string {
    return this.commit(new WrapListEdit(Selector.parse(target), tag));
  }

  /**
   * Copies nodes from `source` into `target` following the package copy semantics.
   *
   * Returns the formatted id (`${peer}:${seq}`) of the recorded local event.
   */
  copy(target: string, source: string): string {
    return this.commit(
      new CopyEdit(Selector.parse(target), Selector.parse(source)),
    );
  }

  /** Materializes the current document into a plain serializable tree. */
  materialize(): PlainNode {
    if (this.cachedDoc !== null) return this.cachedDoc.toPlain() as PlainNode;
    const doc = this.rematerialize();
    this.cachedDoc = doc;
    return doc.toPlain() as PlainNode;
  }

  /** Returns the plain conflict nodes produced during the last materialization. */
  get conflicts(): PlainNode[] {
    return this.lastConflicts.map((conflict) =>
      conflict.toPlain() as PlainNode
    );
  }

  private lastConflicts: Node[] = [];

  /** Rebuilds the internal mutable document tree and refreshes cached conflicts. */
  private rematerialize(): Node {
    const { doc, conflicts } = this.graph.materialize();
    this.lastConflicts = conflicts;
    return doc;
  }

  /** Returns the current cached document, or rematerializes it if the cache is stale. */
  private currentDoc(): Node {
    const doc = this.cachedDoc ?? this.rematerialize();
    this.cachedDoc = doc;
    return doc;
  }

  /**
   * Compacts the event graph after the caller confirms the current globally
   * acknowledged frontier set. This refuses stale frontiers and buffered events.
   */
  compact(acknowledgedFrontiers: string[]): void {
    if (!Array.isArray(acknowledgedFrontiers)) {
      throw new Error(
        "Compaction frontiers must be provided as an array of event ids.",
      );
    }
    if (
      acknowledgedFrontiers.some((frontier) => typeof frontier !== "string")
    ) {
      throw new Error(
        "Compaction frontiers must only contain event id strings.",
      );
    }
    this.graph.compact(
      acknowledgedFrontiers.map((frontier) => EventId.parse(frontier)),
    );
    this.cachedDoc = null;
  }

  /**
   * Resets this peer to a compacted state received from the server.
   *
   * Replaces the internal event graph with one bootstrapped from the
   * compacted initial document, then ingests all remaining events the
   * server sent. Pending local edits that haven't been synced yet are
   * re-applied against the new state when possible. Undo/redo stacks
   * are cleared since the original events no longer exist.
   */
  resetToCompactedState(
    compactedDocument: PlainNode,
    remainingEvents: EncodedRemoteEvent[],
  ): void {
    // Save pending local edits before resetting the graph
    const savedEdits = this.pendingEvents.map((ev) => ev.edit);

    this.graph = new EventGraph(
      Node.fromPlain(compactedDocument),
    );
    for (const event of remainingEvents) {
      this.graph.ingestEvents([decodeRemoteEvent(event)]);
    }
    this.cachedDoc = null;
    this.pendingEvents = [];
    this.undoStack = [];
    this.redoStack = [];

    // Re-apply saved edits against the new graph state
    for (const edit of savedEdits) {
      try {
        const event = this.graph.createEvent(this.peer, edit);
        this.pendingEvents.push(event);
      } catch {
        // Edit no longer applicable against compacted state
      }
    }
    this.cachedDoc = null;
  }

  /** Returns the current document as a plain serializable tree. */
  toPlain(): PlainNode {
    return this.materialize();
  }

  /** Returns a serializable snapshot of all known events for UI inspection. */
  inspectEvents(): EventSnapshot[] {
    return this.graph.snapshotEvents();
  }

  /** Resolves and validates an event id before replaying its retargeted edit payload. */
  private resolveReplaySourceEdit(eventId: string): Edit {
    return this.graph.resolveReplayEdit(EventId.parse(eventId).format());
  }

  /** Collects replayable event ids from step lists without materializing the whole document to plain. */
  private collectRepeatEditEventIds(target: string): string[] {
    const doc = this.currentDoc();
    const matchedNodes = doc.navigate(Selector.parse(target));
    if (matchedNodes.length === 0) return [];
    const eventIds: string[] = [];
    for (const node of matchedNodes) {
      if (!(node instanceof ListNode)) {
        throw new Error(
          `repeatEditsFrom expects list nodes at '${target}', found '${node.constructor.name}'.`,
        );
      }
      for (const stepNode of node.items) {
        eventIds.push(this.readRepeatEditEventId(stepNode, target));
      }
    }
    return eventIds;
  }

  /** Reads a single repeat-edit step record and validates that it carries a string event id. */
  private readRepeatEditEventId(stepNode: Node, target: string): string {
    if (!(stepNode instanceof RecordNode)) {
      throw new Error(
        `repeatEditsFrom expects replay-step records in '${target}', found '${stepNode.constructor.name}'.`,
      );
    }
    const eventIdNode = stepNode.fields.eventId;
    if (
      !(eventIdNode instanceof PrimitiveNode) ||
      typeof eventIdNode.value !== "string"
    ) {
      throw new Error(
        `repeatEditsFrom expects each step in '${target}' to contain a string eventId field.`,
      );
    }
    return eventIdNode.value;
  }

  /** Rejects local adds that would overwrite an existing record field. */
  private validateLocalAddTarget(target: string, field: string): void {
    const doc = this.currentDoc();
    for (const node of doc.navigate(Selector.parse(target))) {
      if (node instanceof RecordNode && field in node.fields) {
        throw new Error(
          `Cannot add field '${field}' because it already exists at '${
            target || "/"
          }'.`,
        );
      }
    }
  }

  /**
   * Evaluates all formula nodes in the current document and returns their results.
   *
   * Formula nodes are tagged records whose `$tag` starts with `"x-formula"`.
   * Results are returned as a map from formula path to computed value or error.
   */
  evaluateFormulas(): Map<string, FormulaResult> {
    const doc = this.currentDoc();
    return evaluateAllFormulasOnNode(doc);
  }

  /**
   * Evaluates all formula nodes and writes their results back into the document.
   *
   * For each formula that evaluates to a primitive value (not an error), this
   * sets the `result` field on the formula record. Formula errors are skipped.
   * Returns the evaluation results map for inspection.
   */
  recomputeFormulas(): Map<string, FormulaResult> {
    const results = this.evaluateFormulas();
    for (const [path, result] of results) {
      if (!(result instanceof FormulaError)) {
        try {
          this.set(`${path}/result`, result);
        } catch {
          // Skip if path doesn't resolve (formula may have been deleted concurrently)
        }
      }
    }
    return results;
  }

  /** Rejects local renames that would overwrite an existing sibling field. */
  private validateLocalRenameTarget(
    target: string,
    from: string,
    to: string,
  ): void {
    if (from === to) return;
    const doc = this.currentDoc();
    for (const node of doc.navigate(Selector.parse(target))) {
      if (
        node instanceof RecordNode && from in node.fields && to in node.fields
      ) {
        throw new Error(
          `Cannot rename field '${from}' to '${to}' at '${
            target || "/"
          }' because '${to}' already exists.`,
        );
      }
    }
  }
}
