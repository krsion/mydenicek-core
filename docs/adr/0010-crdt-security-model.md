# ADR-0010: CRDT Security Model (L1–L5)

**Status:** Accepted (L1–L4) / Deferred (L5) | **Date:** 2025-05

## Context

Collaborative CRDTs need security guarantees without breaking convergence semantics. Events from all peers must be verifiable as authentic, and document access must be controlled, but the CRDT merge function must remain deterministic regardless of delivery order.

## Threat Model

| ID | Threat |
|----|--------|
| T1 | Unauthorized read — peer reads a document they have no role on |
| T2 | Unauthorized write — peer injects events into a document they cannot edit |
| T3 | Author spoofing — peer claims to be another peer's PeerId |
| T4 | Transport tampering — MITM modifies events in transit |
| T5 | Server-side plaintext — server operator can read all document content |

## Options Per Layer

| Layer | Options considered | Chosen |
|-------|--------------------|--------|
| L1 Transport | Plain WS, WSS | WSS (TLS 1.2+) |
| L2 Authentication | None, session tokens, Entra OIDC | Entra OIDC (PKCE) |
| L3 Authorization | None, static roles, ABAC | Role-based ACL in Table Storage |
| L4 Event signing | None, HMAC, RSA-PSS, Ed25519 | Ed25519 |
| L5 E2E encryption | None, AES-GCM per-doc key, MLS (RFC 9420) | **Deferred** |

## Decision

Implement L1–L4. Defer L5.

**Key design choices:**

- **PeerId** = `SHA-256(oid:deviceGuid)` — one keypair per device, stable across token refreshes
- **Keypair storage**: `localStorage` (MVP) — TODO migrate to IndexedDB or WebAuthn hardware key
- **ACL cache TTL**: 60 seconds — accepted eventual consistency window between ACL update and enforcement
- **Revoked keys**: events signed before revocation are accepted (one-way upgrade semantics); no retroactive invalidation of already-merged events
- **Service token** for sync → acl server-to-server: Entra app role `Service` with a dedicated MI

## Consequences

T1–T4 are mitigated. **T5 is explicitly not mitigated**: the sync server and any operator with storage access can read all document content in plaintext. This is documented and accepted for the learning sandbox. L5 implementation is tracked as future work; MLS (RFC 9420) is the preferred candidate when group key agreement is needed at scale.
