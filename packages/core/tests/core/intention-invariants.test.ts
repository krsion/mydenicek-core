/**
 * Intention preservation invariants for the mydenicek CRDT.
 *
 * These tests formalize the intention preservation properties that
 * the selector rewriting rules are designed to achieve. Unlike the
 * convergence properties (tested in core-properties.test.ts), these
 * are NOT guaranteed by the Baquero framework — they are design
 * choices specific to mydenicek's OT-style selector rewriting.
 *
 * Each invariant is named after the property it verifies and references
 * the relevant section of the thesis.
 *
 * Run: deno test tests/core/intention-invariants.test.ts --allow-all --no-check
 */

import { assert, assertEquals } from "@std/assert";
import fc from "fast-check";
import { Denicek, type PlainNode } from "../../mod.ts";

// ── Helpers ──────────────────────────────────────────────────────────

function sync(a: Denicek, b: Denicek): void {
  const af = a.frontiers, bf = b.frontiers;
  for (const e of a.eventsSince(bf)) b.applyRemote(e);
  for (const e of b.eventsSince(af)) a.applyRemote(e);
}

function fullSync(peers: Denicek[]): void {
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < peers.length; i++) {
      for (let j = i + 1; j < peers.length; j++) {
        sync(peers[i]!, peers[j]!);
      }
    }
  }
}

function plain(dk: Denicek): PlainNode {
  return dk.toPlain();
}

function get(doc: PlainNode, ...path: string[]): unknown {
  let node: unknown = doc;
  for (const seg of path) {
    if (node === null || node === undefined) return undefined;
    if (typeof node === "object" && seg in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return node;
}

// ═══════════════════════════════════════════════════════════════════════
// INVARIANT 1: Selector stability
// If a non-structural edit targets a path that no concurrent structural
// edit affects, the edit still hits its target after resolution.
// ═══════════════════════════════════════════════════════════════════════

Deno.test("Intention: non-conflicting data edit preserves its target", () => {
  const initial: PlainNode = {
    $tag: "root",
    left: { $tag: "rec", value: "original" },
    right: { $tag: "rec", value: "untouched" },
  };

  fc.assert(
    fc.property(
      fc.constantFrom("alpha", "beta", "gamma", "delta"),
      (newValue) => {
        const alice = new Denicek("alice", initial);
        const bob = new Denicek("bob", initial);

        // Alice edits left/value
        alice.set("left/value", newValue);
        // Bob renames right (disjoint path — should not affect Alice's edit)
        bob.rename("right", "value", "data");

        fullSync([alice, bob]);

        // Alice's edit must still be present
        const doc = plain(alice);
        assertEquals(
          get(doc, "left", "value"),
          newValue,
          "Alice's set on left/value must survive Bob's rename on right/value",
        );
      },
    ),
    { numRuns: 50 },
  );
});

// ═══════════════════════════════════════════════════════════════════════
// INVARIANT 2: Wildcard completeness
// A wildcard edit applied to parent/* must affect items inserted
// concurrently by other peers.
// ═══════════════════════════════════════════════════════════════════════

Deno.test("Intention: wildcard edit affects concurrent inserts", () => {
  const initial: PlainNode = {
    $tag: "root",
    items: {
      $tag: "ul",
      $items: [
        { $tag: "li", name: "existing" },
      ],
    },
  };

  const alice = new Denicek("alice", initial);
  const bob = new Denicek("bob", initial);

  // Alice changes all tags to "tr"
  alice.updateTag("items/*", "tr");
  // Bob concurrently inserts a new "li" item
  bob.insert("items", -1, { $tag: "li", name: "concurrent" }, true);

  fullSync([alice, bob]);

  // Bob's inserted item must have tag "tr", not "li"
  const doc = plain(alice);
  const items = (doc as Record<string, unknown>).items as Record<
    string,
    unknown
  >;
  const children = items.$items as Record<string, unknown>[];
  for (const child of children) {
    assertEquals(
      child.$tag,
      "tr",
      `All items must have tag 'tr' after wildcard updateTag, got '${child.$tag}'`,
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════
// INVARIANT 3: Index shift correctness
// A concurrent insert before index i shifts a concurrent edit at index i
// to index i+1, preserving intent to target the same item.
// ═══════════════════════════════════════════════════════════════════════

Deno.test("Intention: concurrent insert shifts remove to same logical item", () => {
  const initial: PlainNode = {
    $tag: "root",
    items: {
      $tag: "list",
      $items: [
        { $tag: "item", v: "a" },
        { $tag: "item", v: "b" },
        { $tag: "item", v: "c" },
      ],
    },
  };

  const alice = new Denicek("alice", initial);
  const bob = new Denicek("bob", initial);

  // Alice inserts "NEW" at index 0
  alice.insert("items", 0, { $tag: "item", v: "NEW" });
  // Bob removes index 0 (item "a") — should still remove "a", not "NEW"
  bob.remove("items", 0);

  fullSync([alice, bob]);

  const doc = plain(alice);
  const items = (doc as Record<string, unknown>).items as Record<
    string,
    unknown
  >;
  const children = items.$items as Record<string, unknown>[];
  const values = children.map((c) => (c as Record<string, unknown>).v);

  // "a" should be removed, "NEW" should be present
  assert(!values.includes("a"), "Item 'a' should have been removed by Bob");
  assert(
    values.includes("NEW"),
    "Item 'NEW' should have been inserted by Alice",
  );
  assert(values.includes("b"), "Item 'b' should survive");
  assert(values.includes("c"), "Item 'c' should survive");
});

// ═══════════════════════════════════════════════════════════════════════
// INVARIANT 4: Reference survival through structural edits
// A ReferenceNode's target is retargeted when the target is renamed
// or wrapped.
// ═══════════════════════════════════════════════════════════════════════

// INVARIANT 4: Reference survival through structural edits.
// A ReferenceNode's target is retargeted when the target path is renamed.
// The reference ../../data/source (two levels up from formula/arg to root,
// then down to data/source) must become ../../data/value after rename.
Deno.test(
  "Intention: reference survives rename of its target",
  () => {
    const initial: PlainNode = {
      $tag: "root",
      data: { $tag: "rec", source: "hello" },
      formula: { $tag: "ref-test", arg: { $ref: "../../data/source" } },
    };

    const alice = new Denicek("alice", initial);
    alice.rename("data", "source", "value");

    const doc = plain(alice);
    assertEquals(
      get(doc, "data", "value"),
      "hello",
      "Renamed field should contain original value",
    );
    const formula = get(doc, "formula") as Record<string, unknown>;
    const arg = formula.arg as Record<string, unknown>;
    assertEquals(
      arg.$ref,
      "../../data/value",
      "Reference should be retargeted from source to value after rename",
    );
  },
);

// ═══════════════════════════════════════════════════════════════════════
// INVARIANT 5: Replay equivalence
// Replaying a recorded edit at the current frontier produces the same
// effect as if the edit had been applied concurrently at the recording
// point and transformed through all later edits.
// ═══════════════════════════════════════════════════════════════════════

Deno.test("Intention: replay retargets through structural edits", () => {
  const initial: PlainNode = {
    $tag: "root",
    items: {
      $tag: "ul",
      $items: [
        { $tag: "li", contact: "Alice, alice@ex.com" },
      ],
    },
  };

  const doc = new Denicek("alice", initial);

  // Record: insert a new item at front
  const insertId = doc.insert(
    "items",
    0,
    { $tag: "li", contact: "recorded" },
    true,
  );

  // Now do structural edits AFTER recording
  doc.updateTag("items", "table");
  doc.updateTag("items/*", "td");

  // Replay the recorded insert
  doc.repeatEditFromEventId(insertId);

  // The replayed insert should produce a <td>, not <li>,
  // because the tag updates transform the replay's payload
  const result = plain(doc);
  const items = (result as Record<string, unknown>).items as Record<
    string,
    unknown
  >;
  const children = items.$items as Record<string, unknown>[];

  // All items should be <td> after the tag updates affected the replay
  for (const child of children) {
    assertEquals(
      child.$tag,
      "td",
      `Replayed item should have tag 'td' after structural edit, got '${child.$tag}'`,
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════
// INVARIANT 6: Structural edit composition
// Multiple concurrent structural edits compose correctly: rename + wrap
// transforms a concurrent data edit's selector through both.
// ═══════════════════════════════════════════════════════════════════════

Deno.test("Intention: rename + wrap compose to retarget concurrent edit", () => {
  const initial: PlainNode = {
    $tag: "root",
    speakers: {
      $tag: "list",
      $items: [
        { $tag: "item", name: "Ada" },
      ],
    },
  };

  const alice = new Denicek("alice", initial);
  const bob = new Denicek("bob", initial);
  const carol = new Denicek("carol", initial);

  // Alice renames speakers -> talks
  alice.rename("", "speakers", "talks");
  // Bob wraps each item: item -> { $tag: "wrapper", inner: item }
  bob.wrapRecord("speakers/*/name", "inner", "wrapper");
  // Carol sets the name (original path: speakers/0/name)
  carol.set("speakers/0/name", "Carol's edit");

  fullSync([alice, bob, carol]);

  // All three should converge
  const docA = JSON.stringify(plain(alice));
  const docB = JSON.stringify(plain(bob));
  const docC = JSON.stringify(plain(carol));
  assertEquals(docA, docB, "Alice and Bob should converge");
  assertEquals(docB, docC, "Bob and Carol should converge");

  // Carol's edit should have been retargeted through both rename and wrap
  // The value "Carol's edit" should exist somewhere in the merged document
  assert(
    docA.includes("Carol's edit"),
    "Carol's edit must survive concurrent rename + wrap",
  );
});
