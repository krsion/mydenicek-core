import { assertEquals } from "@std/assert";
import { Denicek } from "@mydenicek/core";

Deno.test("Formative: Conference List", () => {
  const initialDocument = {
    $tag: "div",
    speakers: {
      $tag: "ul",
      $items: [
        { $tag: "li", contact: "Ada Lovelace, ada@example.com" },
        { $tag: "li", contact: "Grace Hopper, grace@example.com" },
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

  alice.pushBack("speakers", { $tag: "li", contact: "Barbara Liskov, barbara@example.com" });
  bob.updateTag("speakers", "table");
  bob.updateTag("speakers/*", "td");
  bob.wrapList("speakers/*", "tr");
  bob.rename("speakers/*/*", "contact", "name");
  bob.add("speakers/*/*", "email", "");

  syncPeers();

  const plainConferenceDocument = bob.toPlain() as {
    speakers: {
      $items: Array<{ $items: Array<{ name: string }> }>;
    };
  };

  for (const [rowIndex, row] of plainConferenceDocument.speakers.$items.entries()) {
    const [name, email = ""] = row.$items[0]!.name.split(",").map((part) => part.trim());
    bob.set(`speakers/${rowIndex}/0/name`, name);
    bob.set(`speakers/${rowIndex}/0/email`, email);
  }

  syncPeers();

  const expected = {
    $tag: "div",
    speakers: {
      $tag: "table",
      $items: [
        { $tag: "tr", $items: [{ $tag: "td", name: "Ada Lovelace", email: "ada@example.com" }] },
        { $tag: "tr", $items: [{ $tag: "td", name: "Grace Hopper", email: "grace@example.com" }] },
        { $tag: "tr", $items: [{ $tag: "td", name: "Barbara Liskov", email: "barbara@example.com" }] },
      ],
    },
  };
  assertEquals(alice.toPlain(), expected);
  assertEquals(bob.toPlain(), expected);
});
