# PoC Analysis: Flec as a Framework for mydenicek

**Date:** 2025-07-17
**Status:** Evaluation / Feasibility study

## 1. Flec's API and Architecture

### 1.1 Overview

Flec (Framework for Loosely-coupled Eventually Consistent systems) is a TypeScript framework for building ambient-oriented collaborative applications using pure operation-based CRDTs. It accompanies the ECOOP 2023 paper *"Nested Pure Operation-Based CRDTs"* by Jim Bauwens and Elisa Gonzalez Boix.

**Repository:** https://gitlab.soft.vub.ac.be/jimbauwens/flec
**Paper:** https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.ECOOP.2023.2

### 1.2 Core Architecture

Flec's architecture is structured around the following layers:

```
┌─────────────────────────────────────────────┐
│  CRDT implementations (AWSet, MVRegister…)  │  ← user-facing
├─────────────────────────────────────────────┤
│  PureOpCRDT<O>                              │  ← PO-Log + redundancy hooks
├─────────────────────────────────────────────┤
│  CRDT_RCB<O, BD>                            │  ← Causal Reliable Broadcast
├─────────────────────────────────────────────┤
│  VectorClock                                │  ← causal metadata
├─────────────────────────────────────────────┤
│  Actor model (AmbientTalk-inspired)         │  ← networking + discovery
└─────────────────────────────────────────────┘
```

#### `CRDT_RCB<O, BD>` — Causal Reliable Broadcast layer

The base class handling:
- **Vector clocks** (`VectorClock`): Track causal ordering across replicas
- **Causal delivery**: Buffered operations are held until their causal dependencies are met (`tryOperation` checks `hasPrecedingDependenciesFor`)
- **Replica discovery**: Actors discover peers via tag-based export/subscribe
- **Stability detection**: `isCausallyStable(clock)` checks if all replicas have observed a given operation. Stable messages (`RCBOp.Stable`) are sent periodically to communicate observation progress
- **Nested CRDT routing**: Parent CRDTs route `NestedCRDTOperation` to child CRDTs via `resolveChild()`
- **Auth hooks**: `preApplyFilter` and `authOp` for access control policies

#### `PureOpCRDT<O>` — The PO-Log

Extends `CRDT_RCB` with the core pure op-based CRDT mechanics:

- **Operation log** (`log: POLogEntry<O>[]`): Flat array of log entries, each carrying a `VectorClock`, operation name, and arguments
- **Redundancy relations** (Baquero's R relations):
  - `isArrivingOperationRedundant(entry)` — R relation: is the new op redundant upon arrival? (e.g., `remove` in AW-Set is never stored)
  - `isPrecedingOperationRedundant(e1, e2)` — R_< relation: does a new op make a preceding entry redundant?
  - `isConcurrentOperationRedundant(e1, e2)` — R_|| relation: does a new op make a concurrent entry redundant?
  - `isRedundantByBufferedOperation(e, entry)` — R_β relation: for buffered (not yet causally delivered) operations
- **Garbage collection hooks**:
  - `markStable()` marks entries whose vector clock is causally stable
  - `compactStable()` removes stable entries and invokes `setEntryStable()` for compaction into sequential state
  - GC is triggered after operations via `cleanup()` when log reaches `logCompactSize`
- **Eval**: There is no explicit `eval()` function. State is derived by iterating the log (e.g., `AWSet.toSet()` filters log entries). This is a **manual per-CRDT eval** pattern

#### `POLogEntry<T>` — Log entries

Each entry carries:
- `operation: keyof T` — the operation name
- `clock: VectorClock` — causal metadata
- `args: any[]` — operation arguments
- `properties: Map<string, EntryPropertyValue>` — extensible metadata (e.g., auth level)
- Dynamic `is<Op>()` methods via Proxy (e.g., `entry.isAdd()`, `entry.isClear()`)
- Causal comparison: `precedes()`, `isConcurrent()`, `follows()`

#### Actor model

Flec uses an AmbientTalk-inspired actor model for networking:
- `Actor` manages object registration, far references, and message delivery
- `TSAT` (Thin Switchboard for AmbientTalk) manages inter-actor communication
- Communication via MQTT or peer-to-peer channels
- Service discovery via tag-based export/subscribe

### 1.3 CRDT Definition Pattern

Defining a new CRDT in Flec requires:

```typescript
// 1. Define operations as a TypeScript interface
interface SetOperations {
    add(element: string);
    remove(element: string);
    clear();
}

// 2. Extend PureOpCRDT and override redundancy hooks
class AWSet extends PureOpCRDT<SetOperations> {
    // R_< : preceding entries made redundant by arriving entry
    protected isPrecedingOperationRedundant(existing, arriving) {
        return arriving.isClear() || existing.hasSameArgAs(arriving);
    }
    // R : arriving op is never stored (remove/clear are "effect-only")
    protected isArrivingOperationRedundant(arriving) {
        return arriving.isRemove() || arriving.isClear();
    }
    // Manual eval: derive state from log
    public toSet(): Set<string> {
        return new Set(this.getLog().map(e => e.args[0]));
    }
    // API methods use this.perform proxy
    public add(element) { this.perform.add(element); }
    public remove(element) { this.perform.remove(element); }
}
```

### 1.4 Nesting

Flec's nested CRDTs (the paper's main contribution) work by:
- `addChild(name, childCRDT)` registers a child CRDT that shares the parent's clock
- Operations are routed via `NestedCRDTOperation` with a path of `{key, op}` pairs
- Parent performs a local "shell" update before forwarding to the child
- `MultiPureOpCRDT` manages multiple instances of the same CRDT type (e.g., per-key maps)

### 1.5 Maturity Assessment

| Aspect | Status |
|--------|--------|
| PO-Log core | Functional but basic (flat array, linear scan) |
| Redundancy relations | Clean hook-based API |
| Stability tracking | Implemented via periodic stable messages |
| GC / compaction | Framework exists but hooks often empty |
| Eval / reactivity | Manual per-CRDT (no reactive framework) |
| Networking | Tightly coupled to actor model |
| Persistence | None |
| Documentation | Minimal (README says "gradually updated") |
| Tests | Present but scope unclear |
| Code quality | Research prototype; commented-out code, TODO comments |
| PO-Log DAG implementation | **Commented out** (`polog.ts` is entirely wrapped in `/* */`) |

---

## 2. Can mydenicek's Selector Rewriting Be Expressed as a Flec CRDT?

### 2.1 mydenicek's Architecture Recap

mydenicek implements a pure op-based CRDT for collaborative structured document editing:

| Baquero concept | mydenicek implementation |
|----------------|--------------------------|
| **prepare** | `Denicek.commit()` — reads current doc, creates `Edit` |
| **effect** | `EventGraph.insertEvent()` — adds tagged event to DAG |
| **eval** | `EventGraph.materialize()` — deterministic topological replay |
| **PO-Log** | `EventGraph.events: Map<string, Event>` — a DAG of events |

Key distinguishing features:
1. **Selector-based targeting**: Edits target document paths (`person/name`, `items/*/value`) not opaque IDs
2. **Selector rewriting (OT)**: When concurrent structural edits (rename, wrap, delete, reindex) change the document shape, later edits' selectors are transformed to follow the new structure. This is the core of mydenicek's intention preservation
3. **Rich edit types**: 12+ edit types (RecordAdd, RecordDelete, RecordRename, ListInsert, ListRemove, ListReorder, WrapRecord, WrapList, Copy, UpdateTag, ApplyPrimitiveEdit, CompositeEdit)
4. **Tree document model**: Records, lists, and primitives with typed navigation
5. **Incremental materialization**: Checkpoint cache + linear extension optimization
6. **Undo/redo**: Inverse edit computation from pre-edit document state

### 2.2 What Fits

**The conceptual mapping is sound.** Both frameworks implement Baquero's pure op-based CRDT model:
- Flec's `PureOpCRDT.onOperation()` ≈ mydenicek's `EventGraph.insertEvent()`
- Flec's redundancy hooks ≈ mydenicek's `Event.resolveAgainst()` (concurrent edit transformation)
- Flec's `POLogEntry` ≈ mydenicek's `Event` (operation + vector clock)
- Flec's log iteration ≈ mydenicek's `materialize()` (though mechanisms differ radically)

**Flec's hook-based redundancy relations could cleanly express simple conflict policies.** For example, a "last-writer-wins on concurrent set" is expressible as:

```typescript
isPrecedingOperationRedundant(existing, arriving) { return true; }
```

### 2.3 What Doesn't Fit

**Selector rewriting is fundamentally incompatible with Flec's PO-Log model:**

1. **Flec's PO-Log is a flat log with pairwise redundancy checks.** mydenicek's "redundancy" is not pairwise — it requires replaying the full causal history in topological order and transforming each edit's selector through all concurrent prior structural edits. This is an ordered transformation pipeline, not a set-membership filter.

2. **Flec has no concept of document state during redundancy checking.** Flec's `isPrecedingOperationRedundant(e1, e2)` takes two log entries and compares their operations/arguments. mydenicek's `Event.resolveAgainst()` requires access to the *current document state* to determine if transformed edits are applicable (`canApply(doc)`, `validate(doc)`).

3. **Flec's operations are untyped bags of arguments.** mydenicek's edits are rich objects with:
   - `transformSelector(sel)` — how this edit changes other selectors
   - `transformLaterConcurrentEdit(concurrent)` — full OT including payload rewriting
   - `withTarget(target)` — retargeting
   - `computeInverse(preDoc)` — undo
   - `mapInsertedPayload()` / `rewritePayloadForWildcard()` — deep payload transformation

   Flec's `POLogEntry` has `operation: keyof T` and `args: any[]`. The entire OT algebra would need to live outside Flec's framework.

4. **Flec's eval is manual and per-type.** Each CRDT type implements its own `toSet()` / `toArray()` / `read()`. mydenicek's eval is a single generic `materialize()` that replays all edits in topological order against the document tree. This replay-based eval is inseparable from the OT-based resolution.

5. **No edit identity or ordering within Flec's eval.** Flec evaluates by scanning the log for surviving entries. mydenicek requires deterministic topological ordering with tie-breaking (`EventId.compareTo`), and edits must be applied sequentially because each structural edit changes the document shape for subsequent edits.

### 2.4 Verdict

**mydenicek's selector rewriting cannot be expressed as a Flec CRDT.** The approaches are both "pure op-based" in Baquero's sense, but they implement the framework at fundamentally different levels of abstraction:

- **Flec**: Operations are opaque tokens. Conflict resolution is pairwise redundancy filtering. Eval scans surviving log entries.
- **mydenicek**: Operations are typed transforms with OT semantics. Conflict resolution is sequential transformation through causal history. Eval is deterministic replay with document state threading.

---

## 3. What We Would Gain

### 3.1 PO-Log Management

**Partially usable.** Flec's `PureOpCRDT` manages log insertion, buffering of out-of-order operations, and the redundancy-hook pattern. However:

- mydenicek's PO-Log is a **DAG** (events have explicit parents forming a causal graph), while Flec's is a **flat array** with vector clocks. The DAG structure is essential for mydenicek's checkpoint caching, `filterCausalPast()`, `eventsSince()`, and incremental materialization.
- mydenicek's log entries carry `Edit` objects with transform methods; Flec entries carry untyped `args`.
- mydenicek already has battle-tested log management with bounds (`maxBufferedRemoteEvents`, `maxReplayTransformations`), deduplication, and corruption detection (`ConflictingEventPayloadError`).

**Net gain: negative.** Flec's PO-Log is simpler than what mydenicek needs.

### 3.2 Causal Stability

**Potentially useful in isolation.** Flec's stability tracking pattern is:
1. After all replicas acknowledge an operation, `isCausallyStable(clock)` returns true
2. Stable entries can be compacted via `setEntryStable()` hooks
3. Stable messages are broadcast periodically

mydenicek currently has `compact()` but requires explicit frontier acknowledgment from all peers. Flec's continuous stability tracking via `remoteClocks` and periodic stable messages is a more automated approach.

**However:** Flec's stability is tightly coupled to its actor model and replica discovery. Extracting it would require reimplementing the protocol. mydenicek's approach (explicit frontier-based compaction) is actually more robust for its relay-server architecture.

**Net gain: marginal.** The protocol idea is interesting but the implementation is inseparable from Flec's actor model.

### 3.3 Reactivity

**Not available.** Despite a paper titled "Improving the reactivity of pure operation-based CRDTs" (PaPoC 2021), Flec's current codebase has **no reactive framework**. The `ReactiveAWSet` simply extends `AWSet` with the same manual `toSet()` eval. The `callback` mechanism on `CRDT_RCB` is a simple notification that *something changed*, not a reactive re-evaluation of derived state.

mydenicek already has a richer change notification pattern: `Denicek.commit()` invalidates `cachedDoc`, and `materialize()` rebuilds on demand with caching. The `FormulaEngine` provides reactive formula evaluation on top.

**Net gain: none.**

---

## 4. What We Would Lose

### 4.1 DAG-Based Event Graph

Flec uses a flat log + vector clocks. mydenicek's `EventGraph` is a proper DAG with:
- Explicit parent edges enabling `filterCausalPast()`, `eventsSince()`, and causal anti-entropy sync
- Checkpoint caching keyed by frontier hashes for O(n) incremental materialization (not O(n²))
- Topological ordering with Kahn's algorithm for deterministic replay
- Linear extension detection for O(1) amortized local edit application

**This is mydenicek's most critical optimization.** Losing it would make materialization O(n²) for n events.

### 4.2 Edit Type System

mydenicek's 12+ typed edits with `transformSelector()`, `transformLaterConcurrentEdit()`, `computeInverse()`, etc. have no equivalent in Flec. The entire OT algebra would need to remain custom.

### 4.3 Selector Navigation

mydenicek navigates selectors against a typed tree (`Node.navigate(selector)`). Flec has no document model — it stores opaque arguments.

### 4.4 Undo/Redo

mydenicek's inverse-edit–based undo materializes at the pre-edit frontier and computes the structural inverse. Flec has no undo support.

### 4.5 Relay Mode

mydenicek's `EventGraph` supports `relayMode` where a server stores/forwards events without needing edit implementations. Flec has no equivalent.

### 4.6 Conflict Surfacing

mydenicek's `NoOpEdit` creates visible conflict nodes in the document tree. Flec silently discards redundant operations.

### 4.7 Robustness

mydenicek has configurable bounds, deduplication, corruption detection, validation against causal state, and atomicity contracts on edits. Flec is a research prototype without these safeguards.

---

## 5. Concrete Integration Path

### 5.1 Option A: Use Flec as-is (Replace EventGraph)

**Not viable.** Flec's PO-Log model (flat array + pairwise redundancy) cannot express mydenicek's replay-based OT semantics. The document model, edit type system, and materialization approach are fundamentally different.

### 5.2 Option B: Extract Flec's Stability Protocol

**Possible but low ROI.** The stability protocol could theoretically be extracted:

1. Track `remoteClocks: Map<peerId, VectorClock>` at the sync layer
2. After each successful broadcast, update remote clocks
3. An event is stable when `min(remoteClocks[peer][eventPeer]) >= eventSeq` for all known peers
4. Periodic "stable" messages piggyback on sync

**What it would replace:** mydenicek's explicit `compact(acknowledgedFrontiers)` could become automatic stability-based compaction.

**Cost:** ~2-3 days to implement the protocol, ~1 week to integrate with the existing sync layer and test. But this is just a protocol pattern — we don't need Flec's code for it.

### 5.3 Option C: Adopt Flec's Redundancy Hook Pattern for New Simple CRDTs

**Possible but niche.** If mydenicek ever needs to support standalone CRDTs alongside its document model (e.g., a replicated counter, a presence set), Flec's hook pattern is a clean API:

```typescript
class PresenceSet extends PureOpCRDT<PresenceOps> {
    protected isPrecedingOperationRedundant(existing, arriving) { ... }
    protected isArrivingOperationRedundant(arriving) { ... }
}
```

**Cost:** Would require extracting `PureOpCRDT` + `POLogEntry` from Flec (~500 lines), decoupling from actor model, and adapting to mydenicek's VectorClock. ~1-2 days.

### 5.4 Option D: Use Flec's Nesting Pattern for Composite Documents

**Not applicable.** Flec nests CRDTs by routing operations through a parent-child tree. mydenicek already has a much richer document tree with typed nodes, selector-based navigation, and cross-node reference integrity. Flec's nesting adds nothing.

### 5.5 What Must Stay Custom

| Component | Reason |
|-----------|--------|
| `EventGraph` (DAG) | Flec's flat log cannot support incremental materialization |
| `Event.resolveAgainst()` (OT) | Selector rewriting is mydenicek's core innovation |
| All `Edit` subclasses | Rich typed edits with transform/inverse algebra |
| `Node` tree + `Selector` | Typed document model with navigation |
| `materialize()` | Replay-based eval inseparable from OT |
| Undo/redo | Inverse computation needs document state |
| Sync protocol | Already works with relay server; Flec's actor model is unsuitable |

---

## 6. Estimated Effort

| Integration option | Effort | Benefit |
|-------------------|--------|---------|
| A. Replace EventGraph with Flec | ∞ (architectural mismatch) | N/A |
| B. Extract stability protocol | 1-2 weeks | Automatic compaction |
| C. Adopt hook pattern for simple CRDTs | 2-3 days | Clean API for ancillary CRDTs |
| D. Nesting pattern | N/A | No benefit |

---

## 7. Recommendation

**Do not adopt Flec.** The architectural mismatch is too deep.

### Why

1. **Flec and mydenicek solve the same problem at different abstraction levels.** Flec provides a clean framework for *simple* pure op-based CRDTs (sets, registers, counters) where conflict resolution is pairwise redundancy. mydenicek's document CRDT requires *stateful sequential replay* with operational transformation — a fundamentally different eval model that Flec cannot accommodate.

2. **Flec is a research prototype.** Key infrastructure is commented out (`polog.ts`), there is no persistence, no incremental eval, minimal documentation, and tight coupling to an actor model we don't use. mydenicek's `EventGraph` is more mature for production use.

3. **The usable pieces are small enough to reimplement.** The stability protocol is ~100 lines of logic. The redundancy hook pattern is a design pattern, not a library dependency. Neither justifies a framework dependency on a research prototype.

### What to Take Away

- **Stability protocol pattern**: If we want automatic compaction, implement Flec's `isCausallyStable()` approach directly in our sync layer. Track peer acknowledgment via vector clock exchange, mark events stable when all peers have observed them, and compact automatically. This is a self-contained protocol addition (~1-2 weeks).

- **Redundancy hook API**: If we ever build standalone CRDTs (presence, awareness, ephemeral state), Flec's `isPrecedingOperationRedundant` / `isArrivingOperationRedundant` / `isConcurrentOperationRedundant` is a clean hook taxonomy. Implement it ourselves when needed.

- **Declarative CRDT specification**: Flec's `set_operations.ts` sketches a decorator-based declarative CRDT definition (`@ConcurrentPriority`, `@RedundantOnArrival`, `@ClearPrevious`). This is an interesting research direction for a future higher-level API if we ever want to let users define custom conflict policies declaratively. Not actionable now, but worth watching.
