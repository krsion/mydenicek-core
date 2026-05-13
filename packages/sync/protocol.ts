import type { Denicek, PlainNode, RemoteEvent } from "@mydenicek/core";
import type { EncodedRemoteEvent, EncodedRemoteEventId } from "@mydenicek/core";
import type { SignedEvent } from "@mydenicek/shared-types";
import { collectRemoteEventsSince } from "./internal-events.ts";

/** Encoded event identifier (opaque string). */
export type EncodedEventId = EncodedRemoteEventId;

/** A sync request sent from client to server. */
export interface EncodedSyncRequest {
  /** Message type discriminator. */
  type: "sync";
  /** Room to sync with. */
  roomId: string;
  /** Stable identifier of the sending peer. */
  peerId?: string;
  /** Client's current frontier event IDs. */
  frontiers: string[];
  /** New events the client wants to send. */
  events: EncodedEvent[];
  /** Signed events used when AUTH_ENABLED is active on the server. */
  signedEvents?: SignedEvent[];
  /** Hash of the client's initial document (before any events). */
  initialDocumentHash?: string;
  /** The initial document tree. Sent with the first sync to bootstrap the room. */
  initialDocument?: PlainNode;
}

/** A sync response sent from server to client. */
export interface EncodedSyncResponse {
  /** Message type discriminator. */
  type: "sync";
  /** Room that was synced. */
  roomId: string;
  /** Server's current frontier event IDs. */
  frontiers: string[];
  /** Events the client hasn't seen yet. */
  events: EncodedEvent[];
  /**
   * Present when the peer needs to reset after server-side compaction.
   * The peer should replace its event graph with one bootstrapped from
   * this document, then ingest the events in the same response.
   */
  compactedDocument?: PlainNode;
}

/** Server greeting sent when a WebSocket connection is established. */
export interface EncodedHelloMessage {
  /** Message type discriminator. */
  type: "hello";
  /** Room the client connected to. */
  roomId: string;
  /** The room's initial document, if set by a previous peer. */
  initialDocument?: PlainNode;
}

/** Error message sent by the server on protocol violations. */
export interface EncodedErrorMessage {
  /** Message type discriminator. */
  type: "error";
  /** Room associated with the error, if applicable. */
  roomId?: string;
  /** Human-readable error description. */
  message: string;
}

/** Union of all sync protocol message types. */
export type EncodedSyncMessage =
  | EncodedSyncRequest
  | EncodedSyncResponse
  | EncodedHelloMessage
  | EncodedErrorMessage;

/** A serialized CRDT event for wire transport. */
export type EncodedEvent = EncodedRemoteEvent;

/** Encode a {@linkcode RemoteEvent} for wire transport. */
export function encodeEvent(event: RemoteEvent): EncodedEvent {
  return event;
}

/** Decode a wire-format event back into a {@linkcode RemoteEvent}. */
export function decodeEvent(
  encodedEvent: EncodedEvent,
): RemoteEvent {
  return encodedEvent;
}

/** Build a sync request containing events the server hasn't seen yet. */
export function createSyncRequest(
  document: Denicek,
  roomId: string,
  knownServerFrontiers: string[],
  initialDocumentHash?: string,
  initialDocument?: PlainNode,
): EncodedSyncRequest {
  return {
    type: "sync",
    roomId,
    peerId: document.peer,
    frontiers: document.frontiers,
    events: collectRemoteEventsSince(document, knownServerFrontiers).map(
      encodeEvent,
    ),
    initialDocumentHash,
    initialDocument,
  };
}

/** Apply events from a sync response to a local Denicek document. */
export function applySyncResponse(
  document: Denicek,
  response: EncodedSyncResponse,
): void {
  if (response.compactedDocument !== undefined) {
    document.resetToCompactedState(
      response.compactedDocument,
      response.events.map(decodeEvent),
    );
    return;
  }
  for (const encodedEvent of response.events) {
    document.applyRemote(decodeEvent(encodedEvent));
  }
}
