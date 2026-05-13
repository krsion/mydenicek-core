/** SHA-256 hex of `${oid}:${deviceGuid}` */
export type PeerId = string;

/** base64-encoded SHA-256 hash of canonical event content */
export type EventHash = string;

/** base64-encoded Ed25519 signature */
export type Ed25519Sig = string;

export interface UnsignedEvent {
  docId: string;
  author: PeerId;
  payload: unknown;
  predecessors: EventHash[];
}

export interface SignedEvent extends UnsignedEvent {
  hash: EventHash;
  signature: Ed25519Sig;
}

export interface PeerKey {
  oid: string;
  deviceGuid: string;
  /** base64-encoded Ed25519 public key */
  pubKey: string;
  /** ISO 8601 creation timestamp */
  createdAt: string;
  /** ISO 8601 revocation timestamp — present means key is revoked */
  revokedAt?: string;
}

export interface Doc {
  id: string;
  title: string;
  ownerOid: string;
  createdAt: string;
  updatedAt: string;
}

export interface AclEntry {
  docId: string;
  principalOid: string;
  role: "owner" | "editor" | "viewer";
}

export interface Attachment {
  id: string;
  docId: string;
  blobUrl: string;
  contentType: string;
  sizeBytes: number;
}
