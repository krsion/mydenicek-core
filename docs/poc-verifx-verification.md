# PoC: VeriFx for Automated Convergence Verification of mydenicek

> **Status**: Evaluation / feasibility analysis
> **Date**: 2025-07-18
> **References**: [VeriFx paper](https://doi.org/10.1145/3563309) ·
> [VeriFx repo](https://github.com/verifx-prover/verifx) ·
> TLA+ spec: `spec/MydenicekCRDT.tla`

---

## 1. VeriFx Overview

### 1.1 Language and DSL

VeriFx is a Scala-like functional OOP language with built-in verification
support. Programs are compiled to SMT-LIB2 formulas and discharged by Z3.

Key language constructs:

```verifx
// Algebraic data types via enums
enum CtrOp { Inc() | Dec() }

// Classes with default constructors (immutable, functional updates)
class Counter(ctr: Int = 0) extends CmRDT[CtrOp, CtrOp, Counter] {
  def increment() = new Counter(this.ctr + 1)
  def effect(op: CtrOp) = op match {
    case Inc() => this.increment()
    case Dec() => this.decrement()
  }
}

// Proof blocks — compiled to SMT and discharged automatically
proof commutativity {
  forall (s: T, x: Op, y: Op) {
    s.effect(x).effect(y) == s.effect(y).effect(x)
  }
}
```

Built-in collections: `Set[V]`, `Map[K,V]`, `Vector[V]`, `LList[V]`,
`Tuple[A,B]`. Generic types and higher-order functions are supported.

### 1.2 Verification Approach

1. VeriFx source (`.vfx`) is parsed into an AST via scala-meta.
2. `proof` blocks are translated to SMT-LIB2 formulas (negation of the
   universally quantified property).
3. Z3 checks satisfiability: **UNSAT** = property proved for all inputs,
   **SAT** = counterexample found.
4. Default timeout: 10 s per proof; retries with random seeds for
   non-deterministic array-theory queries.

This is **unbounded verification** — Z3 reasons over *all* possible states,
not a finite subset. If a proof succeeds, it holds universally.

### 1.3 CRDT Verification in VeriFx

VeriFx ships with 40+ verified CRDTs and 8 verified OT functions.

**For CmRDTs** (op-based), the proof obligation is:

```
∀ s, msg1, msg2:
  compatible(msg1, msg2) ∧ reachable(s) ⟹
    s.effect(msg1).effect(msg2) = s.effect(msg2).effect(msg1)
```

**For OT functions**, VeriFx verifies conditions C1 (convergence) and C2
(composition):

```
// C1 — convergence diamond
∀ opI, opJ, st:
  apply(apply(st, opI), transform(opJ, opI))
  = apply(apply(st, opJ), transform(opI, opJ))

// C2 — three-way composition
∀ opI, opJ, opK, st:
  transform(transform(opK, opI), transform(opJ, opI))
  = transform(transform(opK, opJ), transform(opI, opJ))
```

### 1.4 Existing OT Examples

VeriFx already verifies OT functions for list editing (Ellis, Ressel, Sun,
Suleiman, Imine) operating on `LList[V]` with insert/delete at integer
positions. These examples are directly relevant — they verify exactly the kind
of position-shifting rules we use for `ListInsertAtEdit`/`ListRemoveAtEdit`.

---

## 2. Mapping mydenicek onto VeriFx

### 2.1 Architectural Mismatch

mydenicek is a **pure op-based CRDT** where convergence follows from:

1. Replica state is a G-Set of events (trivially convergent).
2. `materialize` is a deterministic pure function: topological sort → resolve
   → apply.
3. Same event set ⟹ same document (**QED**).

The hard part — which VeriFx *could* help verify — is not convergence itself
but the **correctness of the OT-style selector rewriting rules**
(`transformSelector` / `transformLaterConcurrentEdit`). Specifically:

> Do the selector rewriting rules ensure that for any two concurrent edits,
> applying them in either order (with transformation) produces the same
> document?

This is the classic **TP1 / C1 property** applied to mydenicek's transform
functions.

### 2.2 Can `transformSelector` Be Expressed in VeriFx?

**Yes, with caveats.**

Selectors are slash-separated paths: arrays of segments where each segment is
either a string (field name) or an integer (list index). The core rewriting
rules are:

| Edit             | Rule                               | Complexity |
| ---------------- | ---------------------------------- | ---------- |
| Rename a → b     | `a/… → b/…`                       | Low        |
| Delete a         | `a/… → removed`                   | Low        |
| WrapRecord(f)    | `a/… → a/f/…`                     | Low        |
| WrapList         | `a/… → a/*/…`                     | Medium     |
| Insert at i      | indices ≥ i shift +1               | Low        |
| Remove at i      | index i → removed; indices > i −1  | Low        |
| Reorder(f,t)     | f → t with range shift             | Medium     |

These are all **syntactic rewrites on finite-length selector arrays**. They
can be encoded as operations on VeriFx `Vector[SelectorSegment]` where
`SelectorSegment` is an enum of `Field(name: Int)` and `Index(pos: Int)`.

**Limitation**: VeriFx selectors would need a bounded maximum depth. This is
acceptable — real documents rarely exceed depth 10–15, and Z3 reasons
symbolically over the contents at each position.

**Wildcard expansion** (`*`) is harder. At transform time wildcards are not
expanded (they stay as `*` in selectors). The tricky part is
`rewritePayloadForWildcard`, which modifies inserted nodes to match a prior
wildcard edit. This requires encoding a simplified document structure.

### 2.3 Can `eval` (materialize) Be Expressed?

**Partially, but this is the wrong question.**

The full `materialize` function includes topological sort, checkpoint caching,
and O(N²) replay — none of which need verification (they are implementation
detail). What matters is the **pairwise transform property**:

> For any state `s` and concurrent edits `e1`, `e2`:
> `apply(apply(s, e1), transform(e2, e1)) = apply(apply(s, e2), transform(e1, e2))`

This is exactly VeriFx's OT C1 condition. We encode:
- **State** = a flat record (like the TLA+ model) or a bounded tree
- **Op** = enum of the 11 edit types
- **transform(x, y)** = the `transformLaterConcurrentEdit` logic
- **apply(s, op)** = the edit's `apply` function

### 2.4 State Space Analysis: Can Z3 Handle 11 Edit Types with Trees?

**Estimated state space for the PoC (flat record model, like TLA+)**:

| Parameter      | Value          | Impact                    |
| -------------- | -------------- | ------------------------- |
| Edit types     | 11 (enum)      | 11 × 11 = 121 C1 cases   |
| Selector depth | ≤ 4 segments   | `Vector[Segment]`         |
| Field names    | symbolic (Int) | Unbounded, handled by Z3  |
| List indices   | symbolic (Int) | Unbounded integer theory  |
| Document       | Flat record    | `Map[Int, Value]`         |

Z3 handles integer arithmetic and case analysis well. The 121 edit-pair C1
proofs decompose into independent proof obligations — VeriFx can split them
into separate `proof` blocks, each targeting a specific (editA, editB) pair.

**Risk: tree-structured documents.** A nested tree document (records containing
lists containing records) requires either:
- **Flattened encoding**: tree as `Map[Selector, Value]` (a trie). Feasible
  for bounded depth. Z3 handles `Map` well via its array theory.
- **Recursive ADT**: VeriFx **does not support recursion**. Cannot define
  `Node = Record(Map[String, Node]) | List(LList[Node]) | Prim(Value)`.

The flattened trie encoding is the practical path. The TLA+ spec already uses
this approach (flat record = `Map[FieldName, Value]`).

**Estimated Z3 effort per proof**: For the existing VeriFx OT examples
(insert/delete on lists), Z3 discharges each C1 sub-case in under 10 seconds.
Our cases are structurally similar but involve more case splitting. Expect
10–60 seconds per proof, with some complex cases (e.g., WrapRecord vs.
ListReorder) potentially requiring manual `reachable()` constraints.

---

## 3. Comparison with TLA+ Model Checking

| Dimension                | TLA+ (current)                         | VeriFx (proposed)                       |
| ------------------------ | -------------------------------------- | --------------------------------------- |
| **Verification type**    | Bounded model checking (TLC)           | Unbounded SMT proving (Z3)              |
| **Coverage**             | 5 edit types, 2 peers, MaxSeq=3        | All 11 edit types, arbitrary states     |
| **Completeness**         | Sound for checked bounds only          | **Complete** — if proved, holds ∀ inputs |
| **State explosion**      | Exponential in peers × edits           | Per-proof, no state graph               |
| **What it verifies**     | Full system (sync + materialize + SEC) | Pairwise OT correctness (C1, C2)        |
| **Liveness**             | Yes (EventualConvergence under WF)     | No (static properties only)             |
| **Time to run**          | Minutes–hours                          | Seconds per proof                       |
| **Counterexamples**      | Full execution trace                   | Symbolic (state + ops)                  |
| **Effort to extend**     | Add to AllEdits + XForm                | One transform impl per edit type        |

**Key insight**: The approaches are complementary.

- **TLA+** verifies the **whole system** (sync protocol, G-Set union, full
  materialization pipeline) but only on a small finite model. It catches
  end-to-end bugs like incorrect topological sort tie-breaking.
- **VeriFx** can verify **pairwise transform correctness** for all possible
  inputs. It catches bugs like "Rename + WrapRecord don't commute when the
  rename target is inside the wrapped subtree" — cases that the bounded TLA+
  model may never explore.

**What VeriFx gives us that TLA+ doesn't**:
1. **Unbounded proof**: No worry about "did we pick large enough bounds?"
2. **All 11 edit types**: The TLA+ model has 5; extending to 11 causes state
   explosion. VeriFx handles 121 pairs independently.
3. **Symbolic selectors**: Z3 reasons about arbitrary field names and indices,
   not just `{"f1", "f2"}`.
4. **Fast iteration**: Changing a transform rule and re-proving takes seconds,
   not hours.

---

## 4. Concrete PoC: RecordAddEdit + RecordRenameFieldEdit

### 4.1 VeriFx Encoding

Below is a concrete VeriFx encoding of the two simplest record edits and
the `transformSelector` + C1 proof. This follows the OT verification pattern
from the existing VeriFx examples.

```verifx
// --- Selector representation ---
// Segments are integers: positive = field name ID, negative = list index
// Selector is a bounded-length vector of segments
class Selector(s0: Int, s1: Int, s2: Int, len: Int) {
  def get(i: Int): Int =
    if (i == 0) this.s0
    else if (i == 1) this.s1
    else this.s2

  def withSeg(i: Int, v: Int): Selector =
    if (i == 0) new Selector(v, this.s1, this.s2, this.len)
    else if (i == 1) new Selector(this.s0, v, this.s2, this.len)
    else new Selector(this.s0, this.s1, v, this.len)
}

// --- Edit types ---
enum RecordEdit {
  Add(target: Selector, value: Int) |
  Delete(target: Selector) |
  Rename(target: Selector, toField: Int) |
  NoOp()
}

// --- Flat-record document: Map from field-name ID to value ---
class FlatDoc(fields: Map[Int, Int]) {
  def get(f: Int): Int = this.fields.getOrElse(f, 0)
  def set(f: Int, v: Int): FlatDoc =
    new FlatDoc(this.fields.add(f, v))
  def remove(f: Int): FlatDoc =
    new FlatDoc(this.fields.remove(f))
  def rename(from: Int, to: Int): FlatDoc = {
    val v = this.fields.getOrElse(from, 0)
    new FlatDoc(this.fields.remove(from).add(to, v))
  }
}

// --- transformSelector for Rename ---
// If the selector's first segment matches the rename source,
// rewrite it to the rename target.
def transformSelectorRename(sel: Selector, renFrom: Int, renTo: Int): Selector = {
  if (sel.len > 0 && sel.get(0) == renFrom)
    sel.withSeg(0, renTo)
  else
    sel
}

// --- Transform: rewrite a later concurrent edit through a prior ---
def transform(prior: RecordEdit, later: RecordEdit): RecordEdit = {
  prior match {
    case Rename(target, toField) => {
      val renFrom = target.get(target.len - 1)
      later match {
        case Add(t, v) =>
          new Add(transformSelectorRename(t, renFrom, toField), v)
        case Delete(t) =>
          if (t.len > 0 && t.get(0) == renFrom)
            new Delete(transformSelectorRename(t, renFrom, toField))
          else
            later
        case Rename(t, to2) =>
          if (t.len > 0 && t.get(0) == renFrom)
            new Rename(transformSelectorRename(t, renFrom, toField), to2)
          else
            later
        case NoOp() => later
      }
    }
    case Delete(target) => {
      val delField = target.get(target.len - 1)
      later match {
        case Add(t, v) =>
          // Add to deleted field: still apply (add overwrites)
          later
        case Delete(t) =>
          if (t.len > 0 && t.get(0) == delField) new NoOp()
          else later
        case Rename(t, to2) =>
          if (t.len > 0 && t.get(0) == delField) new NoOp()
          else later
        case NoOp() => later
      }
    }
    case _ => later  // Add and NoOp don't transform selectors
  }
}

// --- Apply edit to document ---
def applyEdit(doc: FlatDoc, edit: RecordEdit): FlatDoc = {
  edit match {
    case Add(t, v) => doc.set(t.get(0), v)
    case Delete(t) => doc.remove(t.get(0))
    case Rename(t, to) => doc.rename(t.get(0), to)
    case NoOp() => doc
  }
}

// --- C1 proof: convergence diamond ---
object RecordOT {
  proof C1_AddAdd {
    forall (doc: FlatDoc, e1: RecordEdit, e2: RecordEdit) {
      (e1.isInstanceOf[Add] && e2.isInstanceOf[Add]) =>:
        (applyEdit(applyEdit(doc, e1), transform(e1, e2))
         == applyEdit(applyEdit(doc, e2), transform(e2, e1)))
    }
  }

  proof C1_AddRename {
    forall (doc: FlatDoc, e1: RecordEdit, e2: RecordEdit) {
      (e1.isInstanceOf[Add] && e2.isInstanceOf[Rename]) =>:
        (applyEdit(applyEdit(doc, e1), transform(e1, e2))
         == applyEdit(applyEdit(doc, e2), transform(e2, e1)))
    }
  }

  proof C1_RenameRename {
    forall (doc: FlatDoc, e1: RecordEdit, e2: RecordEdit) {
      (e1.isInstanceOf[Rename] && e2.isInstanceOf[Rename]) =>:
        (applyEdit(applyEdit(doc, e1), transform(e1, e2))
         == applyEdit(applyEdit(doc, e2), transform(e2, e1)))
    }
  }

  // ... one proof per (editType1, editType2) pair
}
```

### 4.2 What This PoC Tests

This encoding verifies, **for all possible field names, values, and document
states**, that:

- Concurrent Add + Add converge
- Concurrent Add + Rename converge (the rename rewrites the add's field)
- Concurrent Rename + Rename converge (chained rewriting)
- Concurrent Delete + Add converge
- Concurrent Delete + Rename converge (rename becomes no-op)
- Concurrent Delete + Delete converge

This is a strict superset of what the TLA+ model checks for these edit types,
because TLA+ only checks `{f1, f2} × {v1, v2}` while VeriFx proves it for
all integers.

### 4.3 Expected Outcome

Based on the existing VeriFx OT examples (which verify similar list-OT
functions in <10 s each), we expect:

- **3 × 3 = 9 proof obligations** for {Add, Delete, Rename} × {Add, Delete, Rename}
- Each proof: **5–30 seconds** on a modern machine
- Total PoC: **~5 minutes** Z3 time

If any proof fails, Z3 returns a **concrete counterexample**: specific field
names, values, and document state that violate C1 — directly actionable for
debugging.

---

## 5. Feasibility of Full 11-Edit-Type Verification

### 5.1 Edit-Pair Matrix

With 11 edit types, C1 requires **11 × 11 = 121** proof obligations (or 66
unique pairs if we exploit symmetry). Grouped by complexity:

| Category                      | Pairs | Difficulty | Notes                                    |
| ----------------------------- | ----- | ---------- | ---------------------------------------- |
| Record × Record               | 9     | Low        | Flat field rewrites (PoC above)          |
| Record × List                 | 9     | Medium     | Cross-type: rename doesn't affect index  |
| List × List                   | 9     | Medium     | Index shifting (like existing VeriFx OT) |
| Record × Tree (Wrap/Unwrap)   | 12    | Medium     | Selector insertion/removal               |
| List × Tree                   | 12    | High       | Index shift + path insertion             |
| Tree × Tree                   | 16    | High       | Nested path transformations              |
| Anything × Copy               | 20    | Very High  | Two selectors, mirroring                 |
| Anything × ApplyPrimitive     | 10    | Low        | Non-structural, identity transform       |

### 5.2 Encoding Challenges

**Selector depth.** The real system has unbounded selectors. In VeriFx we must
fix a maximum depth (e.g., 4–6 segments). This is not a fundamental limitation
— if the transform is correct for depth-k selectors, it is correct for
depth-(k+1) by structural induction on the suffix (which is not touched by the
transform). We can state this inductive argument informally and verify the
base cases mechanically.

**WrapRecord/WrapList path insertion.** These edits insert a new segment into
the middle of a selector:

```
WrapRecord("items/0", field="inner"):
  sel "items/0/name" → "items/0/inner/name"
```

This requires shifting all segments after the match point. Encodable with
bounded-depth `Vector`, but requires careful index arithmetic.

**CopyEdit mirroring.** CopyEdit has two selectors and creates mirror edits
(CompositeEdit). This is the most complex case — it requires encoding the
mirror-creation logic and verifying that the composite edit commutes. May
require decomposing into sub-lemmas.

**Wildcard expansion.** Wildcards are not expanded at transform time — they
stay as `*`. The `rewritePayloadForWildcard` hook modifies inserted payloads.
Encoding this requires a simplified document model where we can "apply" an
edit to a subtree. Feasible but adds encoding complexity.

**Negative/strict indices.** Negative indices are resolved using a stored
`listLength`. Strict indices skip shifting. These are straightforward integer
conditions, well within Z3's capabilities.

### 5.3 What VeriFx Cannot Verify

1. **Full-system convergence**: VeriFx verifies pairwise OT correctness, not
   the end-to-end system (sync, topological sort, checkpoint cache). Keep TLA+
   for system-level properties.

2. **N-way commutativity**: C1 proves pairwise commutativity. For N > 2
   concurrent edits, you need C2 (three-way composition) or an inductive
   argument. VeriFx can verify C2 but the formula is larger (3 ops × state).
   However, mydenicek doesn't need classical C2 because the replay order is
   fixed — the edits are not applied in arbitrary peer-local orders but in a
   deterministic global order. What we actually need is that `resolveAgainst`
   (sequential transformation through all concurrent priors) is
   order-independent when the priors are reordered. This is a custom property
   we would need to formulate.

3. **Recursive tree traversal**: `canApply` and `apply` navigate the document
   tree recursively. VeriFx cannot encode this. We verify the *transform*
   (selector rewriting) correctness, and trust `apply` via testing.

4. **Intention preservation**: "Did the user get what they meant?" is a design
   choice, not a formal property. VeriFx can verify convergence (everyone sees
   the same thing) but not intent.

### 5.4 Effort Estimate

| Phase                                        | Effort     | Output                                  |
| -------------------------------------------- | ---------- | --------------------------------------- |
| VeriFx environment setup (Scala + Z3)        | 1–2 days   | Running VeriFx with existing examples   |
| PoC: 3 record edits (§4)                     | 2–3 days   | 9 C1 proofs, validated                  |
| Extend to list edits (Insert, Remove, Reorder) | 3–5 days | +27 pairs (leveraging VeriFx list OT)   |
| Add tree edits (Wrap, Unwrap, UpdateTag)     | 5–7 days   | +48 pairs, bounded-depth selectors      |
| CopyEdit + mirroring                         | 3–5 days   | +20 pairs, CompositeEdit encoding       |
| ApplyPrimitiveEdit (trivial)                 | 0.5 days   | +10 pairs (identity transform)          |
| C2 / sequential-resolve proof                | 3–5 days   | Optional: 3-way composition             |
| Documentation + integration                  | 2–3 days   | Proof artifacts, CI integration         |
| **Total**                                    | **~4–6 weeks** | **121 C1 proofs + optional C2**     |

---

## 6. Recommendation

### Use VeriFx for pairwise OT verification; keep TLA+ for system-level checking.

**Rationale**:

1. **VeriFx is a strong fit for verifying `transformSelector` rules.** These
   are exactly the kind of syntactic rewriting functions VeriFx was built to
   verify — see the existing OT examples (Ellis, Ressel, etc.) which verify
   analogous list-position transformations.

2. **Unbounded proofs close the gap left by TLA+.** The TLA+ model covers 5 of
   11 edit types with small bounds. VeriFx can cover all 121 edit pairs with
   symbolic (unbounded) field names and indices.

3. **The encoding is tractable.** The core transform rules are syntactic
   rewrites on bounded-depth selectors — well within Z3's capabilities.
   Existing VeriFx OT examples discharge similar proofs in seconds.

4. **CopyEdit is the main risk.** Its two-selector + mirroring design is
   significantly more complex than anything in VeriFx's existing examples.
   Budget extra time and consider simplifying the encoding (e.g., verify the
   mirror-creation logic separately from the selector rewriting).

5. **Keep TLA+ running.** VeriFx verifies OT correctness (pairwise), not
   end-to-end system convergence. TLA+ catches bugs in the sync protocol,
   topological sort, and materialization pipeline. The two tools are
   complementary.

### Suggested roadmap

1. **Week 1**: Set up VeriFx, reproduce existing OT examples, implement the
   3-edit PoC from §4. If any C1 proof fails, investigate whether it's an
   encoding error or a real transform bug.

2. **Week 2–3**: Extend to all 11 edit types with flat-record document model.
   Start with non-structural edits (trivial), then record edits, then list
   edits, then tree edits.

3. **Week 4–5**: Tackle CopyEdit mirroring and wildcard-payload rewriting.
   These are the hardest cases and may require manual lemma decomposition.

4. **Week 6**: Optional C2 / sequential-resolve property. Write up proof
   artifacts. Integrate proof-checking into CI (VeriFx proofs run in seconds
   and can be a build step).

### What success looks like

- **121 C1 proof obligations discharged**, covering all edit-type pairs
- **Symbolic counterexamples** for any bugs found during encoding
- **Confidence statement**: "The selector rewriting rules of mydenicek are
  verified correct (convergent) for all possible selector paths of depth ≤ k,
  all field names, all list indices, and all document states, via automated
  SMT proving."
- This is a **strictly stronger guarantee** than the current TLA+ bounded
  model, complementing it rather than replacing it.
