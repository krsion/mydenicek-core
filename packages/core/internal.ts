/**
 * @module
 * Internal re-exports for sibling monorepo packages.
 *
 * This module exposes low-level primitives (events, edits, selectors,
 * vector clocks) consumed by other packages in the mydenicek monorepo.
 * It is **not** part of the stable public API for external consumers.
 */
export {
  ApplyPrimitiveEdit,
  CopyEdit,
  Edit,
  NoOpEdit,
  RecordAddEdit,
  RecordDeleteEdit,
  RecordRenameFieldEdit,
  UnwrapListEdit,
  UnwrapRecordEdit,
  UpdateTagEdit,
  WrapListEdit,
  WrapRecordEdit,
} from "./core/edits.ts";
export {
  ListInsertAtEdit,
  ListRemoveAtEdit,
  ListReorderEdit,
} from "./core/edits.ts";
export { Event } from "./core/event.ts";
export { EventId } from "./core/event-id.ts";
export { Node } from "./core/nodes.ts";
export { decodeRemoteEvent, encodeRemoteEvent } from "./core/remote-events.ts";
export type {
  EncodedRemoteEvent,
  EncodedRemoteEventId,
  RemoteEvent,
} from "./core/remote-events.ts";
export {
  applyRegisteredPrimitiveEdit,
  registerPrimitiveEdit,
} from "./core/primitive-edits.ts";
export { Selector } from "./core/selector.ts";
export { VectorClock } from "./core/vector-clock.ts";
export { CausalStabilityTracker } from "./core/causal-stability.ts";
