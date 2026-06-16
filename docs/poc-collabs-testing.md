# PoC Analysis: Collabs TestingRuntimes for mydenicek

**Date:** 2025-07-15
**Status:** Evaluation complete — **not recommended for adoption**

## 1. What TestingRuntimes Provides

`TestingRuntimes` lives in `@collabs/crdts` (source: `crdts/src/util/testing_runtimes.ts`, ~120 LOC). It is a thin in-memory message-queuing harness around Collabs' own `CRuntime`.

### API Surface

```ts
class TestingRuntimes {
  // Create a new CRuntime linked to all prior runtimes
  newRuntime(options?: {
    rng?: seedrandom.prng;           // deterministic replicaID
    causalityGuaranteed?: boolean;    // skip causal buffering
    skipRedundantLoads?: boolean;     // test idempotence
  }): CRuntime;

  // Deliver queued messages from sender → recipients
  release(sender: CRuntime, ...recipients: CRuntime[]): void;

  // Deliver all queued messages between all runtimes
  releaseAll(): void;

  // Observability
  getTotalSentBytes(): number;
  lastMessage?: Uint8Array;
}
```

### How It Works

1. Each `CRuntime` emits a `"Send"` event containing a `Uint8Array` message.
2. `TestingRuntimes` intercepts these events and enqueues them per (sender, recipient) pair.
3. Messages remain queued until `release()` or `releaseAll()` is called.
4. On release, the recipient's `CRuntime.receive(message)` is called.

```
local op → CRuntime.transact() → "Send" event
   → TestingRuntimes queue (Map<sender, Map<recipient, Uint8Array[]>>)
   → release(sender, recipient)
   → CRuntime.receive(message) → deserialize → apply to Collabs
```

### Capabilities

- **Selective delivery:** `release(alice, bob)` delivers only Alice's messages to Bob.
- **Deterministic replay:** Seed-based replicaID via `seedrandom`.
- **Causal buffering:** `CRuntime` internally buffers out-of-order messages.
- **Byte tracking:** Sent/received byte counters for benchmarking.
- **State transfer:** `CRuntime.save()`/`load()` for snapshot-based sync.

## 2. Comparison with Our fast-check Approach

| Dimension | mydenicek (fast-check) | Collabs (TestingRuntimes) |
|---|---|---|
| **Generation** | fast-check generates random op sequences with weighted arbitraries | Tests are hand-written or use manual loops |
| **Shrinking** | Automatic minimal counterexample on failure | No shrinking — failures show full trace |
| **Network model** | `sync(a, b)` as an explicit operation in the generated trace | `release(sender, ...recipients)` with per-pair queues |
| **Delivery control** | Bidirectional sync is an atomic operation in the trace | Unidirectional: release sender→recipient only |
| **Out-of-order delivery** | Explicit shuffled-delivery test (`OutOfOrder` suite) | CRuntime's `CausalMessageBuffer` handles internally |
| **Sync order permutation** | Exhaustive N! permutation test | Not built-in; must be coded manually |
| **Concurrency patterns** | 3-peer + 5-peer tests with interleaved edits/syncs | Typically 2–4 runtimes with manual scripting |
| **Properties tested** | Convergence, idempotency, commutativity, intent preservation | Convergence (via assertions after releaseAll) |
| **Test count** | 310 property tests × 500–2000 runs each | Typically 1–20 hand-crafted scenarios per CRDT |
| **CRDT coupling** | Works on raw `EncodedRemoteEvent` objects (JSON-serializable) | Tightly coupled to Collabs `CRuntime` binary format |

### What TestingRuntimes Adds That We Don't Have

**Unidirectional selective delivery.** Our `sync(a, b)` is bidirectional — both peers exchange all missing events. TestingRuntimes can deliver Alice→Bob without delivering Bob→Alice, enabling asymmetric partition tests. However, we can already achieve this with:

```ts
for (const e of alice.eventsSince(bob.frontiers)) bob.applyRemote(e);
```

**Per-message queuing.** Messages are held individually and delivered one at a time. Our `eventsSince` returns all missing events at once. But again, we can iterate them individually if needed.

### What We Already Have That TestingRuntimes Lacks

- **Automatic shrinking** (fast-check)
- **Exhaustive sync-order permutation** (`assertAllSyncOrdersConverge`)
- **Shuffled delivery** (seed-based Fisher-Yates)
- **Weighted operation generation** tuned per document shape
- **5-peer convergence** tests
- **Algebraic property verification** (idempotency, commutativity)

## 3. Can TestingRuntimes Be Used Standalone?

**No.** TestingRuntimes is fundamentally inseparable from the Collabs runtime:

1. **CRuntime is mandatory.** `newRuntime()` returns a `CRuntime`, and `release()` calls `CRuntime.receive()`. The message format is Collabs' internal protobuf-based binary encoding — not interoperable.

2. **Messages are opaque Uint8Array.** CRuntime serializes messages with `MessageSerializer` (custom binary + protobuf metadata). Our `EncodedRemoteEvent` is a plain JSON-serializable object with `{id, parents, edit, clock}`. The formats are incompatible.

3. **Collabs require `registerCollab()`.** CRuntime routes messages to named Collabs registered at startup. We have a single monolithic `Denicek` document — no registration step.

4. **Dependency chain.** `@collabs/crdts` → `@collabs/core` → protobufjs, seedrandom. Installing brings ~2MB of dependencies for functionality we cannot use.

### Could We Extract Just the Queue Logic?

The queue itself is trivial (~30 LOC):

```ts
// This is the entire queue pattern from TestingRuntimes:
const queues = new Map<Peer, Map<Peer, Event[]>>();

function enqueue(sender: Peer, event: Event) {
  for (const [recipient, queue] of queues.get(sender)!) {
    queue.push(event);
  }
}

function release(sender: Peer, ...recipients: Peer[]) {
  for (const recipient of recipients) {
    for (const event of queues.get(sender)!.get(recipient)!) {
      recipient.applyRemote(event);
    }
    queues.get(sender)!.set(recipient, []);
  }
}
```

We gain nothing from depending on `@collabs/crdts` for this.

## 4. Concrete Integration Plan: What Would It Look Like?

If we wanted TestingRuntimes-style controlled delivery, here's how we'd build it **natively** for mydenicek:

```ts
import { Denicek, type EncodedRemoteEvent } from "@mydenicek/core";

class TestingNetwork {
  private queues = new Map<Denicek, Map<Denicek, EncodedRemoteEvent[]>>();

  addPeer(peer: Denicek): void {
    const peerQueue = new Map<Denicek, EncodedRemoteEvent[]>();
    for (const [existing, existingQueue] of this.queues) {
      peerQueue.set(existing, []);
      existingQueue.set(peer, []);
    }
    this.queues.set(peer, peerQueue);
  }

  /** Queue events produced by sender for later delivery. */
  enqueue(sender: Denicek): void {
    const events = sender.drain();
    for (const [, queue] of this.queues.get(sender)!) {
      queue.push(...events);
    }
  }

  /** Deliver queued events from sender to specific recipients. */
  release(sender: Denicek, ...recipients: Denicek[]): void {
    if (recipients.length === 0) {
      recipients = [...this.queues.keys()].filter((r) => r !== sender);
    }
    const senderQueues = this.queues.get(sender)!;
    for (const recipient of recipients) {
      for (const event of senderQueues.get(recipient)!) {
        recipient.applyRemote(event);
      }
      senderQueues.set(recipient, []);
    }
  }

  /** Deliver all queued events. */
  releaseAll(): void {
    for (const sender of this.queues.keys()) this.release(sender);
  }
}

// Usage in a test:
Deno.test("asymmetric partition convergence", () => {
  fc.assert(
    fc.property(
      fc.array(arbFlatListOp, { minLength: 5, maxLength: 30 }),
      (ops) => {
        const net = new TestingNetwork();
        const peers = Array.from({ length: 3 }, (_, i) => {
          const p = new Denicek(`peer${i}`, FLAT_LIST_DOC);
          net.addPeer(p);
          return p;
        });

        for (const op of ops) {
          if (op.kind === "sync") {
            // Selective unidirectional delivery
            net.enqueue(peers[op.a]!);
            net.release(peers[op.a]!, peers[op.b]!);
          } else {
            applyEditOpWithExplicitRejection(peers[op.peer]!, op.op);
            net.enqueue(peers[op.peer]!);
          }
        }

        // Final full sync
        for (const p of peers) net.enqueue(p);
        net.releaseAll();
        // Second pass to propagate transitive events
        for (const p of peers) net.enqueue(p);
        net.releaseAll();

        assertConvergence(peers);
      },
    ),
    { numRuns: 2000 },
  );
});
```

**This is ~50 lines of infrastructure** and uses our existing fast-check arbitraries, shrinking, and assertion helpers.

## 5. Estimated Effort

| Approach | Effort | Value |
|---|---|---|
| Install @collabs/crdts and try to use TestingRuntimes | 0.5 day | **Zero** — incompatible message formats |
| Build adapter layer to bridge Collabs↔mydenicek | 3–5 days | **Negative** — maintenance burden, no new testing power |
| Build native `TestingNetwork` (as shown above) | **0.5 day** | **High** — adds unidirectional delivery control to existing tests |
| Extend current test suite with asymmetric partitions | 1 day | **High** — catches new bug classes |

## 6. Recommendation

**Do not adopt Collabs TestingRuntimes.** The reasons:

1. **Incompatible architecture.** Collabs' `CRuntime` uses protobuf-encoded binary messages routed to registered Collab objects. mydenicek uses JSON-serializable `EncodedRemoteEvent` objects applied to a monolithic `Denicek` document. There is no useful interop point.

2. **The queue pattern is trivial.** The only valuable idea — holding messages in a queue and releasing them selectively — is 30 lines of code that we can implement natively.

3. **We already have superior testing.** Our fast-check suite provides automatic shrinking, exhaustive sync-order permutation, shuffled delivery, algebraic property verification, and 310 tests across 5 document shapes. TestingRuntimes provides none of this.

4. **Unnecessary dependency.** Adding `@collabs/crdts` brings protobufjs, seedrandom, and the entire Collabs CRDT framework (~2MB) for zero functional benefit.

### What To Do Instead

If we want to strengthen network testing (which is a reasonable goal):

1. **Build a native `TestingNetwork` class** (~50 LOC, shown in §4) that adds unidirectional delivery and per-message queuing to our existing infrastructure.

2. **Add new fast-check arbitraries** for network topologies:
   - Asymmetric partitions (A→B but not B→A)
   - Message reordering within a single sender's stream
   - Message duplication/replay
   - Network healing after partition

3. **Keep fast-check** for generation and shrinking — this is our real testing superpower.

These additions would cost ~1.5 days and provide strictly more testing power than Collabs TestingRuntimes, without any new dependencies.
