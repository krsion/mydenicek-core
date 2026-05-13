# ADR 0010: CRDT Security Model (L1–L4)

## Context

mydenicek now supports authenticated collaboration. We need to reduce risks from
forged identities, unauthorized document writes, and tampered CRDT events while
keeping loginless development mode available.

Threat model:

- **T1**: Anonymous or spoofed client can connect and write.
- **T2**: Client can claim a different author identity in event payloads.
- **T3**: Client can write to documents it is not authorized for.
- **T4**: Client can forge or tamper with CRDT events in transit.
- **T5**: Server-side compromise can read plaintext document payloads.

Defense layers:

- **L1**: Verified Entra identity bound to socket session.
- **L2**: Stable peer identity derived from `sha256(oid:deviceGuid)`.
- **L3**: ACL checks on connect and per-event authorization checks.
- **L4**: Ed25519 signatures on every CRDT event.
- **L5**: End-to-end encryption.

## Options

1. **L1 only** (identity at connection): insufficient against forged/tampered
   event payloads.
2. **L1–L3**: blocks unauthorized access but still trusts transport content.
3. **L1–L4**: identity + authorization + cryptographic event integrity.
4. **L1–L5**: strongest model, but significantly more key-management and UX
   complexity for this phase.

## Decision

Adopt **L1–L4** now, defer **L5**.

- Sync server is feature-flagged by `AUTH_ENABLED`.
- Client signing is feature-flagged by `VITE_AUTH_ENABLED`.
- Public keys are stored in the existing ACL service (`peers` table in
  `sa-acl`).
- ACL and peer-key reads in sync use an in-process LRU cache with a TTL of 60s.
  No push invalidation yet.
- **One-way upgrade semantics**: when `AUTH_ENABLED=true`, sync rejects unsigned
  events and invalid signatures; when disabled, legacy unsigned mode keeps
  working.

## Consequences

- Positive:
  - Event-level cryptographic integrity for CRDT operations.
  - Better blast-radius control with per-document ACL decisions.
  - Additive rollout path via feature flags.
- Trade-offs:
  - Key revocation can take up to 60 seconds to propagate due to cache TTL.
  - Device loss recovery and key rotation UX require follow-up work.
  - L5 confidentiality against malicious infrastructure remains out of scope.

## Future work

- Add push invalidation for ACL/peer-key caches.
- Implement L5 end-to-end encryption for document payloads.
- Add device recovery and multi-device key lifecycle workflows.
