# PoC Analysis: Model-Guided Fuzzing for mydenicek CRDT

**Date:** 2025-07-14
**Status:** Feasibility assessment
**Paper:** Ozkan et al., "Model-Guided Fuzzing of Distributed Systems" ([arXiv:2410.02307](https://arxiv.org/abs/2410.02307))

---

## 1. Ozkan's Approach: How Model-Guided Fuzzing Works

### Core Idea

ModelFuzz uses an **abstract TLA+ specification** as a coverage guide for fuzzing
real implementations. Traditional coverage-guided fuzzers (like AFL) use code-level
metrics (line/branch coverage). ModelFuzz instead tracks **which abstract states in
the TLA+ model** have been visited during a test execution, and prioritizes
generating new test cases that explore under-covered model states.

### The Fuzzing Loop

1. **Generate** an initial set of random test cases (sequences of events/schedules).
2. **Execute** each test case against the real implementation, intercepting system
   events (message deliveries, crashes, restarts).
3. **Map events to TLA+ actions** via an *event mapper* — translate concrete system
   events into the corresponding abstract TLA+ actions.
4. **Simulate in TLC** — feed the mapped action sequence to a *controlled TLC
   execution* (a modified TLC model checker running in server mode on port 2023)
   that replays the abstract actions and reports the set of TLA+ states visited.
5. **Compute coverage** — if this execution covered **new** TLA+ states not seen
   before, keep the test case in the corpus.
6. **Mutate** — for each test that achieved new coverage, create N mutated variants
   (e.g., reorder messages, inject extra crashes) and add them to the queue.
7. **Repeat** until the time budget expires.

### State Abstraction

Raw TLA+ states can be too fine-grained (e.g., monotonically increasing term
numbers in Raft create infinite new states without new *behavioral* information).
ModelFuzz applies a post-processing **state abstraction** that merges states
differing only in irrelevant dimensions. This does not require modifying the TLA+
spec — it is a post-processing step on TLC output.

### Key Results

- Found **13 previously unknown bugs** in RedisRaft, **1 new bug** in Etcd-raft.
- 4 of these bugs were *only* detectable via model-guided fuzzing — random,
  line-coverage-guided, trace-coverage-guided, and RL-based approaches all missed
  them within the same time budget.
- Achieves 1.2–2.8× more abstract state coverage than random/trace/line-guided
  approaches.
- Complements RL-based approaches (BonusMaxRL): comparable coverage but better bug
  detection due to targeted exploration of corner cases.

---

## 2. Tool Availability and Runtime Targets

### Is ModelFuzz Open Source?

**Partially.** The artifact is available on Zenodo
([doi:10.5281/zenodo.15753950](https://doi.org/10.5281/zenodo.15753950)) and
includes:

| Component | Language | Repository |
|---|---|---|
| Controlled TLC server | Java (modified TLC) | `tlc-controlled/` in artifact |
| Core fuzzing algorithm | **Go** library | `modelfuzz/` in artifact |
| Etcd-raft fuzzer | Go | `raft-fuzzing/` |
| RedisRaft fuzzer | Go + C | `redisraft-fuzzing/` |
| 2PC fuzzer | Go | `2PC-Fuzzing/` |
| Microbenchmark | C# (Coyote framework) | `coyote-concurrency-testing/` |
| TLA+ models & configs | TLA+ | `tla-benchmarks/` |

Key repositories referenced in the paper:
- `github.com/burcuku/tlc-controlled-with-benchmarks` — modified TLC with
  controlled execution mode (HTTP endpoint for real-time simulation)
- `github.com/egeberkaygulcan/committer-fuzzing` — 2PC/3PC fuzzing in Go

### What Language/Runtime Does It Target?

The **fuzzer core** is a **Go library** (`modelfuzz/`) with abstract interfaces.
The **controlled TLC** is Java-based. The **system under test** (SUT) can be in
any language, but the paper's implementations are all in **Go** or **C**.

The architecture requires:
1. **Instrumenting the SUT** to intercept messages/events and expose them to the
   fuzzer loop.
2. **An event mapper** that translates concrete events → TLA+ abstract actions.
3. **Network communication** with the controlled TLC server (JSON over HTTP, port
   2023).

### Can It Work with Deno/TypeScript?

**Not out of the box.** The existing tool targets Go/C systems with message-passing
architectures (Raft, 2PC). Adapting it to Deno/TypeScript would require:

| Aspect | Difficulty | Notes |
|---|---|---|
| Running the controlled TLC server | Easy | Java; no changes needed |
| Writing an event mapper (TS → TLA+) | Medium | Map CRDT ops to TLA+ `AllEdits` actions |
| Instrumenting the SUT | Medium | mydenicek already exposes events via `inspectEvents()` and `eventsSince()` |
| Writing the fuzzer loop in TS | Hard | Rewrite the Go `modelfuzz/` library in TS, or use the Go library as a sidecar |
| Integration with fast-check | Medium | Replace the Go fuzzer loop with fast-check's generation + custom scheduler |

**The fundamental mismatch:** ModelFuzz's architecture assumes a long-running SUT
process that exchanges messages (like Raft nodes), where the fuzzer controls
message delivery order. mydenicek is a **library** tested via in-process calls —
there are no network messages to intercept. The fuzzer would need to control the
*sequence of edit operations and sync events*, not message delivery.

---

## 3. Mapping TLA+ States to fast-check Generators

### What the TLA+ Spec Models

The `MydenicekCRDT.tla` spec defines a small, bounded model:
- **Peers:** `{p1, p2, p3}` (set of peer identifiers)
- **Events per peer:** bounded by `MaxSeq`
- **Fields:** `FieldNames` (e.g., `{"a", "b"}`)
- **Values:** `{"v1", "v2"}`
- **5 edit types:** `Add`, `Rename`, `PushBack`, `Delete`, `Wrap`
- **3 actions:** `LocalEdit(peer)`, `SendSync(from, to)`, `ReceiveSync(peer)`
- **State:** `events` (per-peer G-Set), `nextSeq`, `channels`

### What the fast-check Tests Generate

The property tests use `fc.oneof(...)` with weights to generate `Op[]` sequences:
- 10 edit types (add, delete, rename, set, insert, remove, wrapRecord, wrapList,
  updateTag, copy)
- sync operations between peer pairs
- 5 document shapes (flat list, flat record, nested, deep, reference)
- 3–5 peers, 5–120 operations per test, 500–2000 runs per property

### The Mapping

| TLA+ State Component | fast-check Equivalent |
|---|---|
| `events[peer]` (G-Set) | `peer.inspectEvents()` |
| `nextSeq[peer]` | `peer.inspectEvents().length + 1` |
| `channels` | Not modeled (sync is synchronous in tests) |
| `LocalEdit(peer)` with edit ∈ `AllEdits` | `{ kind: "edit", peer, op: EditOp }` |
| `SendSync(from, to)` + `ReceiveSync` | `{ kind: "sync", a, b }` → `sync(peers[a], peers[b])` |
| `Materialize(events[peer])` | `peer.toPlain()` |
| `Convergence` invariant | `assertConvergence(peers)` |

### Key Gap: The TLA+ Spec Is Simpler

The TLA+ spec uses a **flat record** model with 5 edit types and 2 value constants.
The implementation supports:
- **Nested** trees (lists of records of lists)
- **10** edit types (including `copy`, `updateTag`, `wrapList`, `set`, `insert`,
  `remove`)
- **Wildcard selectors** (`rows/*`, `grid/*/*`)
- **References** (`$ref`)

The TLA+ model is a sound *abstraction* of the flat-record subset, but it does not
cover the full implementation. Model-guided fuzzing would only guide the fuzzer
toward interesting *flat-record edit combinations*, not nested/list scenarios.

---

## 4. Concrete PoC Plan: Lightweight Model-Guided Generator

Instead of running the full ModelFuzz infrastructure (controlled TLC + Go library),
we can build a **lightweight approximation** directly in TypeScript/fast-check:

### Approach: TLA+ State Coverage via In-Process Simulation

1. **Enumerate TLA+ abstract states** offline using TLC's simulation mode.
   Run `tlc -simulate` on `MydenicekCRDT.tla` with small bounds (MaxSeq=3, 2
   peers, 2 fields) and collect all reachable `(edit-type-sequence,
   concurrent-edit-pairs)` tuples. This is the **coverage target set**.

2. **Build a coverage map** that tracks which abstract edit-type combinations have
   been tested. The key dimensions are:
   - Which **pairs of concurrent edit types** have been tested (5×5 = 25 pairs)
   - Which **edit-type sequences** of length 2–3 per peer have been tested
   - Which **sync interleavings** (edit-before-sync vs. edit-after-sync) have been
     tested
   - Whether the **rename-vs-X transformation** path was exercised (the core of the
     OT logic)

3. **Create a model-guided fast-check `Arbitrary`** that:
   - Maintains a coverage map across runs (using fast-check's `beforeEach` hook or
     a module-level variable)
   - After each test run, extracts the abstract state:
     ```typescript
     function abstractState(peers: Denicek[]): string {
       // Extract: set of concurrent edit-type pairs that were resolved
       // during materialization
       const events = peers[0].inspectEvents();
       const editTypes = events.map(e => e.type);
       const concurrentPairs = findConcurrentPairs(events);
       return JSON.stringify({ editTypes: [...new Set(editTypes)].sort(),
                               concurrentPairs });
     }
     ```
   - Biases generation toward **under-covered combinations**:
     ```typescript
     const modelGuidedEdit = fc.frequency(
       ...editTypeWeights.map(([type, weight]) => ({
         weight: baseCoverage[type] < threshold ? weight * BOOST : weight,
         arbitrary: arbForType(type),
       }))
     );
     ```

4. **Prioritize the 25 concurrent-edit-type pairs** from the TLA+ spec:
   - `Rename × Add` (the core XForm path)
   - `Rename × Rename` (chained renames)
   - `Rename × Delete` (rename + delete conflict)
   - `Rename × Wrap` (rename + structural change)
   - `Wrap × Add`, `Wrap × Delete`, etc.
   - `Delete × Add` (resurrect after delete)

   These are exactly the combinations the TLA+ `XForm` function handles. Random
   fuzzing may under-explore rare pairs (e.g., `Wrap × Rename` with specific field
   overlap).

5. **Detect new coverage** and **mutate** by varying:
   - The sync point (before/after which edits)
   - The number of edits before first sync (concurrency depth)
   - Field names (to trigger/avoid field overlap in renames)

### Implementation Sketch

```typescript
// coverage-guided-arbitrary.ts
import fc from "fast-check";

type ConcurrentPair = `${string}×${string}`;

const EDIT_TYPES = ["Add", "Rename", "PushBack", "Delete", "Wrap"] as const;
const ALL_PAIRS: ConcurrentPair[] = EDIT_TYPES.flatMap((a) =>
  EDIT_TYPES.map((b) => `${a}×${b}` as ConcurrentPair)
);

const coverageMap = new Map<ConcurrentPair, number>();
ALL_PAIRS.forEach((p) => coverageMap.set(p, 0));

function boostWeight(pair: ConcurrentPair, baseWeight: number): number {
  const covered = coverageMap.get(pair) ?? 0;
  return covered < 5 ? baseWeight * 10 : baseWeight;
}

/** Generate an op sequence that targets a specific concurrent pair */
function arbTargetedSequence(
  pair: ConcurrentPair
): fc.Arbitrary<Op[]> {
  const [typeA, typeB] = pair.split("×");
  return fc.tuple(arbEditOfType(typeA), arbEditOfType(typeB)).map(
    ([editA, editB]) => [
      { kind: "edit", peer: 0, op: editA },
      { kind: "edit", peer: 1, op: editB },
      { kind: "sync", a: 0, b: 1 },
    ]
  );
}

/** After each test run, update coverage */
function recordCoverage(peers: Denicek[]): void {
  const concurrentPairs = extractConcurrentEditPairs(peers);
  for (const pair of concurrentPairs) {
    coverageMap.set(pair, (coverageMap.get(pair) ?? 0) + 1);
  }
}
```

### What This Doesn't Do (vs. Full ModelFuzz)

- No real-time TLC simulation — we approximate state coverage with edit-type
  pairs instead of full TLA+ state vectors.
- No mutation of promising test cases — we rely on fast-check's shrinking.
- No feedback loop within a single `fc.assert` run — fast-check generates all
  inputs up front (though we can use `fc.scheduler` for more control).

### What This Does Better Than Random

- **Systematically covers all 25 concurrent edit-type pairs**, including rare ones
  like `Wrap × Rename` that random fuzzing under-explores.
- **Targets field-overlap scenarios** where the OT transformation is exercised (e.g.,
  `Rename("a","b")` concurrent with `Add("a","v1")` — the exact case the TLA+
  `XForm` handles).
- **Controls concurrency depth** — ensures some tests have 0 syncs before N edits
  (maximum concurrency), which random generation with sync weight 3/8 may not
  consistently produce.

---

## 5. What Bugs Could This Find That Random Fuzzing Can't?

### Bug Classes That Model-Guided Fuzzing Targets

1. **Rare concurrent edit-type combinations.** With 10 edit types and weighted
   random generation, some pairs are statistically under-explored. For example,
   `wrapRecord` has weight 1 and `rename` has weight 2 in `arbFlatRecordEdit` —
   the probability of a concurrent `wrap × rename` on the *same field* across two
   peers is approximately:
   ```
   P(wrap) × P(rename_same_field) ≈ (1/13) × (2/13 × 1/5) ≈ 0.24%
   ```
   With 2000 runs of 50 ops each, we get ~2400 opportunities, so ~6 expected hits.
   But with 3 peers and sync interleaving, many of those won't actually be
   concurrent. Model guidance would guarantee coverage.

2. **Deep concurrency (many edits before first sync).** The fast-check generators
   interleave syncs with weight 3/8. The probability of having 5+ consecutive edits
   across different peers before any sync is low. The TLA+ model explores states
   with `MaxSeq` edits per peer before any sync — these are high-concurrency
   scenarios where OT bugs are most likely.

3. **Multi-step transformation chains.** The TLA+ `Resolve` function applies
   `XForm` iteratively through all concurrent priors. A bug might only manifest when
   edit C is transformed through *both* concurrent priors A and B, where A's
   transformation changes the field that B's transformation targets. Random fuzzing
   has low probability of generating this specific 3-way pattern.

4. **Rename chain conflicts.** `Rename(a→b)` concurrent with `Rename(b→c)` — the
   TLA+ spec handles this through `XForm` which rewrites `edit.from`. A bug could
   occur if the implementation applies these in the wrong order or fails to chain
   the rewrites. This is a specific 2-edit concurrent pattern that the model
   explicitly covers but random fuzzing may not consistently hit with the right
   field values.

### Realistic Assessment

Our existing test suite is already quite thorough:
- 310 tests, 2000 runs per property, up to 120 ops per sequence
- Multiple document shapes (flat, nested, deep, reference)
- Sync-order permutation tests
- Dedicated structural conflict tests (rename + wrap + add)

The bugs that model-guided fuzzing is most likely to find would be in **edge cases
of the transformation logic** where specific field overlaps matter, or in
**very-high-concurrency scenarios** (many concurrent edits before first sync) that
random generation under-samples.

---

## 6. Estimated Effort

### Option A: Full ModelFuzz Integration (Java TLC + Go sidecar)

| Task | Effort | Notes |
|---|---|---|
| Set up controlled TLC server | 2 days | Docker + Java; well-documented in artifact |
| Write event mapper (TS → TLA+ actions) | 3–5 days | Map 5 TLA+ edit types to 10 impl edit types |
| Write fuzzer loop in Go or TS | 5–8 days | Port `modelfuzz/` Go library or write TS equivalent |
| Integrate with Deno test harness | 3–5 days | Subprocess management, JSON protocol |
| Testing and tuning | 3–5 days | State abstraction, mutation strategies |
| **Total** | **16–25 days** | ~3–5 weeks |

### Option B: Lightweight Model-Guided fast-check (PoC)

| Task | Effort | Notes |
|---|---|---|
| Enumerate TLA+ concurrent-edit-pair coverage targets | 1 day | Manual analysis of `XForm` cases |
| Build coverage-tracking `Arbitrary` | 2–3 days | Extend existing fast-check generators |
| Add targeted concurrent-pair generation | 2–3 days | 25 pair-specific generators |
| Add concurrency-depth control | 1 day | Vary sync placement |
| Integrate coverage reporting | 1 day | Log under-covered pairs |
| **Total** | **7–9 days** | ~1.5–2 weeks |

### Option C: Manual Coverage-Gap Analysis (No Tooling)

| Task | Effort | Notes |
|---|---|---|
| Enumerate all XForm cases from TLA+ spec | 0.5 day | 5×5 = 25 cases, most are identity |
| Write targeted hand-written tests for each case | 2–3 days | ~15 meaningful tests |
| Add high-concurrency stress tests | 1 day | 0 syncs until all edits are done |
| **Total** | **3–4 days** | < 1 week |

---

## 7. Recommendation

### Go with Option B (Lightweight Model-Guided fast-check), phased:

**Phase 1 (3 days): Coverage-gap analysis.**
Enumerate the 25 concurrent edit-type pairs from the TLA+ `XForm` function. Check
which are well-covered by existing tests by instrumenting a test run. Identify
the under-explored pairs.

**Phase 2 (5 days): Model-guided generator.**
Build a coverage-tracking fast-check `Arbitrary` that biases toward under-explored
pairs. Add concurrency-depth control (force high-concurrency scenarios). Run with
10,000+ iterations and compare bug-finding rate vs. baseline.

**Phase 3 (optional, if Phase 2 finds bugs): Full ModelFuzz exploration.**
If the lightweight approach reveals that there *are* unexplored state-space regions
with bugs, invest in the full TLC integration for systematic coverage.

### Why Not Full ModelFuzz?

1. **Architecture mismatch.** ModelFuzz is designed for message-passing distributed
   systems (Raft, 2PC) where the fuzzer controls network scheduling. mydenicek is
   a library with synchronous in-process calls. The adaptation cost is high.

2. **TLA+ spec is too abstract.** The spec models a flat record with 5 edit types
   and 2 values. The implementation has nested trees, 10 edit types, wildcards, and
   references. Full ModelFuzz would only guide flat-record testing, missing the
   complex nested scenarios where bugs are more likely.

3. **Existing test quality is high.** With 310 tests, 2000 runs, 5 document shapes,
   and sync-order permutation testing, the marginal value of model guidance is
   lower than in the paper's scenarios (Etcd-raft with limited existing tests).

4. **The Go library is not production-ready.** The artifact is research-quality
   code, documented primarily for artifact evaluation. Adapting it to a TS/Deno
   ecosystem would be more rewriting than integration.

### What We Gain from the Lightweight Approach

- **Systematic coverage of all OT transformation cases** — the concrete contribution
  of the TLA+ spec to testing, without the infrastructure overhead.
- **High-concurrency scenarios** that random fuzzing under-samples.
- **Measurable coverage metrics** — we can report "N/25 concurrent edit-type pairs
  covered" as a concrete testing adequacy measure for the thesis.
- **Fast iteration** — changes to the generator are immediate, no Docker/Java/Go
  toolchain required.

---

## Appendix: TLA+ XForm Coverage Matrix

The `XForm(prior, edit)` function in the TLA+ spec defines how a concurrent `prior`
transforms an `edit`. The meaningful cases (where transformation is non-trivial)
are:

| Prior ↓ / Edit → | Add | Rename | PushBack | Delete | Wrap |
|---|---|---|---|---|---|
| **Rename** | field rewrite if `edit.field == prior.from` | `from` rewrite if `edit.from == prior.from` | field rewrite if `edit.field == prior.from` | field rewrite if `edit.field == prior.from` | field rewrite if `edit.field == prior.from` |
| **Delete** | identity (no-op handling in `ApplyEdit`) | identity | identity | identity | identity |
| **Wrap** | identity (flat-model approx) | identity | identity | identity | identity |
| **Add** | identity | identity | identity | identity | identity |
| **PushBack** | identity | identity | identity | identity | identity |

The 5 non-trivial cases (Rename × *) are the primary targets for model-guided
generation. The field-overlap condition (`edit.field == prior.from`) is what makes
these bugs hard to trigger randomly — it requires both peers to target the same
field, which is `1/|FieldNames|` probability per edit pair.
