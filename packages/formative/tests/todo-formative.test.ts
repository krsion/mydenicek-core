import { assertEquals } from "@std/assert";
import { Denicek } from "@mydenicek/core";

Deno.test("Formative: Todo App", () => {
  const initialDocument = {
    $tag: "app",
    items: {
      $tag: "ul",
      $items: [
        { $tag: "task", text: "Ship prototype", completed: true },
        { $tag: "task", text: "Write paper", completed: false },
      ],
    },
  };
  const alice = new Denicek("alice", initialDocument);
  const bob = new Denicek("bob", initialDocument);

  const syncPeers = (): void => {
    const aliceFrontiers = alice.frontiers;
    const bobFrontiers = bob.frontiers;
    for (const event of alice.eventsSince(bobFrontiers)) bob.applyRemote(event);
    for (const event of bob.eventsSince(aliceFrontiers)) alice.applyRemote(event);
  };

  alice.pushBack("items", { $tag: "task", text: "Review feedback", completed: false });
  bob.set("items/1/completed", true);

  syncPeers();

  alice.pushBack("items", { $tag: "task", text: "Book venue", completed: false });
  {
    const plainDocument = alice.toPlain() as {
      items: { $items: Array<{ $tag: string; text: string; completed: boolean }> };
    };
    const remainingItems = plainDocument.items.$items.filter((item) => !item.completed);
    alice.add("", "__scratchItems", { $tag: "ul", $items: [] });
    for (const item of remainingItems) {
      alice.pushBack("__scratchItems", item);
    }
    alice.copy("items", "__scratchItems");
    alice.delete("", "__scratchItems");
  }
  syncPeers();
  {
    const plainDocument = bob.toPlain() as {
      items: { $items: Array<{ $tag: string; text: string; completed: boolean }> };
    };
    const remainingItems = plainDocument.items.$items.filter((item) => !item.completed);
    bob.add("", "__scratchItems", { $tag: "ul", $items: [] });
    for (const item of remainingItems) {
      bob.pushBack("__scratchItems", item);
    }
    bob.copy("items", "__scratchItems");
    bob.delete("", "__scratchItems");
  }
  syncPeers();

  const expected = {
    $tag: "app",
    items: {
      $tag: "ul",
      $items: [
        { $tag: "task", text: "Review feedback", completed: false },
        { $tag: "task", text: "Book venue", completed: false },
      ],
    },
  };
  assertEquals(alice.toPlain(), expected);
  assertEquals(bob.toPlain(), expected);
});
