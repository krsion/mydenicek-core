export type PeerId = string;
export type EventHash = string;
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
  pubKey: string;
  createdAt: string;
  revokedAt?: string;
}
