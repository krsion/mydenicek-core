import { assertEquals } from "@std/assert";

import type { UnsignedEvent } from "@mydenicek/shared-types";
import {
  generateKeypair,
  pubKeyToBase64,
  signEvent,
  verifyEvent,
} from "../mod.ts";

Deno.test("sign/verify round-trip succeeds", async () => {
  const { pubKey, privKey } = await generateKeypair();
  const unsignedEvent: UnsignedEvent = {
    docId: "doc-a",
    author: "peer-a",
    payload: { op: "set", value: 1 },
    predecessors: [],
  };
  const signedEvent = await signEvent(unsignedEvent, privKey);
  assertEquals(await verifyEvent(signedEvent, pubKey), true);
  assertEquals(typeof pubKeyToBase64(pubKey), "string");
});

Deno.test("tampered event payload is rejected", async () => {
  const { pubKey, privKey } = await generateKeypair();
  const unsignedEvent: UnsignedEvent = {
    docId: "doc-b",
    author: "peer-b",
    payload: { op: "set", value: 1 },
    predecessors: ["e1"],
  };
  const signedEvent = await signEvent(unsignedEvent, privKey);
  const tamperedEvent = {
    ...signedEvent,
    payload: { op: "set", value: 2 },
  };
  assertEquals(await verifyEvent(tamperedEvent, pubKey), false);
});

Deno.test("wrong key verification fails", async () => {
  const leftPair = await generateKeypair();
  const rightPair = await generateKeypair();
  const unsignedEvent: UnsignedEvent = {
    docId: "doc-c",
    author: "peer-c",
    payload: { op: "insert", value: "x" },
    predecessors: ["e1", "e2"],
  };
  const signedEvent = await signEvent(unsignedEvent, leftPair.privKey);
  assertEquals(await verifyEvent(signedEvent, rightPair.pubKey), false);
});
