/**
 * @module
 * WebSocket sync server and client for the Denicek CRDT.
 *
 * Provides a ready-to-use sync server ({@linkcode createSyncServer}),
 * a browser/Deno sync client ({@linkcode SyncClient}), and the
 * underlying protocol types for custom integrations.
 *
 * ```ts
 * import { createSyncServer } from "@mydenicek/sync";
 *
 * createSyncServer({ port: 8787, persistencePath: "./data" });
 * ```
 */

export {
  applySyncResponse,
  createSyncRequest,
  decodeEvent,
  encodeEvent,
} from "./protocol.ts";
export type {
  EncodedErrorMessage,
  EncodedEvent,
  EncodedEventId,
  EncodedHelloMessage,
  EncodedSyncMessage,
  EncodedSyncRequest,
  EncodedSyncResponse,
} from "./protocol.ts";
export { SyncRoom } from "./room.ts";
export { createSyncServer } from "./server.ts";
export type { SyncServerHandle, SyncServerOptions } from "./server.ts";
export { createAclClient } from "./src/acl-client.ts";
export type { AclClient, AclClientOptions } from "./src/acl-client.ts";
export {
  computePeerId,
  isAuthEnabled,
  resolveConnectionIdentity,
} from "./src/auth.ts";
export type { ConnectionIdentity, ConnectionRole } from "./src/auth.ts";
export {
  mapSignedPayloadToEncodedEvents,
  validateInboundSignedEvents,
} from "./src/guard.ts";
export {
  computeDocumentHash,
  computeDocumentHashSync,
  SyncClient,
} from "./client.ts";
export type { SyncClientOptions } from "./client.ts";

// Re-export core types used in the public API so deno doc --lint is satisfied.
export {
  Denicek,
  type EncodedRemoteEdit,
  type EncodedRemoteEvent,
  type EncodedRemoteEventId,
  type EventSnapshot,
  FormulaError,
  type FormulaResult,
  type PlainList,
  type PlainNode,
  type PlainRecord,
  type PlainRef,
  type PrimitiveValue,
  type RemoteEvent,
} from "@mydenicek/core";
