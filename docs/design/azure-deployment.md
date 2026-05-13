# Azure Deployment Design

## 5.9 CRDT security (L1–L4)

When auth is enabled, signed CRDT events flow through identity, ACL, and
signature checks.

```mermaid
sequenceDiagram
    participant C as mywebnicek client
    participant A as ACL service
    participant S as sync server

    C->>A: POST /peers/:oid/keys (register pubkey)
    C->>S: WebSocket upgrade + bearer token + deviceGuid
    S->>A: getRole(docId, oid)
    A-->>S: viewer/editor/null
    C->>S: signed sync event
    S->>A: GET /peers/by-peerid/:peerId/key
    A-->>S: active pubkey
    S->>S: docId match, author overwrite, role check, verify signature, rate limit
    S-->>C: sync response/fanout
```

L5 end-to-end encryption is intentionally deferred.
