import { assertEquals } from "@std/assert";
import { Denicek, registerPrimitiveEdit } from "@mydenicek/core";

Deno.test("Formative: Hello World", () => {
  const initialDocument = {
    $tag: "app",
    messages: {
      $tag: "ul",
      $items: ["heLLo woRLD", "gOOD mORning", "denICEk FORmative"],
    },
  };
  const recordedPeer = new Denicek("recorded", initialDocument);
  const replayPeer = new Denicek("replay", initialDocument);
  const capitalizeMessageWords = (message: string): string =>
    message
      .toLowerCase()
      .split(" ")
      .filter((word) => word.length > 0)
      .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
      .join(" ");

  registerPrimitiveEdit("capitalize", (value) => {
    if (typeof value !== "string") {
      throw new Error("capitalize expects a string.");
    }
    return capitalizeMessageWords(value);
  });

  {
    const capitalizeEventId = recordedPeer.applyPrimitiveEdit("messages/0", "capitalize");
    for (const event of recordedPeer.drain()) {
      replayPeer.applyRemote(event);
    }

    replayPeer.replayEditFromEventId(capitalizeEventId, "messages/*");
  }

  const expected = {
    $tag: "app",
    messages: {
      $tag: "ul",
      $items: ["Hello World", "Good Morning", "Denicek Formative"],
    },
  };
  assertEquals(recordedPeer.toPlain(), {
    $tag: "app",
    messages: {
      $tag: "ul",
      $items: ["Hello World", "gOOD mORning", "denICEk FORmative"],
    },
  });
  assertEquals(replayPeer.toPlain(), expected);
});
