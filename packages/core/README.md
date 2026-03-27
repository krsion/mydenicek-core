# mydenicek-core

A CRDT for collaborative editing of a tagged document tree.

`mydenicek-core` models a document as a tree of tagged records, lists, primitive values, and references. Each peer records edits as events in a causal DAG and converges by replaying the same event set in deterministic order.

## Install

```ts
import { Denicek } from "jsr:@mydenicek/core";
```

## Quick start

```ts
import { Denicek } from "jsr:@mydenicek/core";

const doc = new Denicek("alice", {
  $tag: "root",
  title: "Hello",
  items: { $tag: "items", $items: [] },
});

doc.set("title", "Hello, world");
doc.pushBack("items", { $tag: "item", name: "First task" });

console.log(doc.toPlain());
```

## Sync two peers

The package exposes opaque event payloads for replication. You do not need to inspect their internals; you only need to move them between peers.

```ts
import { Denicek } from "jsr:@mydenicek/core";

const alice = new Denicek("alice", { $tag: "root", title: "Draft" });
const bob = new Denicek("bob", { $tag: "root", title: "Draft" });

alice.set("title", "Alice title");
bob.set("title", "Bob title");

for (const event of alice.eventsSince(bob.frontiers)) bob.applyRemote(event);
for (const event of bob.eventsSince(alice.frontiers)) alice.applyRemote(event);

console.log(alice.toPlain());
console.log(bob.toPlain());
```

## Document model

- `PlainRecord`: a tagged object with named fields
- `PlainList`: a tagged list of child nodes
- `PrimitiveValue`: `string | number | boolean`
- `PlainRef`: a selector string pointing at another node

Selectors use slash-separated paths such as:

- `"title"`
- `"items/0/name"`
- `"items/*/status"`

## Editing operations

`Denicek` provides high-level document operations:

- `add`
- `delete`
- `rename`
- `set`
- `pushBack`
- `pushFront`
- `popBack`
- `popFront`
- `updateTag`
- `wrapRecord`
- `wrapList`
- `copy`

## Development

From the repository root:

```sh
deno check packages/core/mod.ts
deno test --allow-all --no-check packages/core/tests
deno test --allow-all --no-check packages/formative/tests
deno test packages/core/tests/core-properties.test.ts --allow-all
deno run packages/core/tools/core-random-fuzzer.ts
```
