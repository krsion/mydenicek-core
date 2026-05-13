import { assertEquals, assertNotEquals } from "jsr:@std/assert";
import {
  base64ToPubKey,
  canonicalEventHash,
  generateKeypair,
  pubKeyToBase64,
  signEvent,
  verifyEvent,
} from "../mod.ts";
import type { UnsignedEvent } from "@mydenicek/shared-types";

function makeEvent(overrides?: Partial<UnsignedEvent>): UnsignedEvent {
  return {
    docId: "doc-1",
    author: "peer-abc",
    payload: { text: "hello", count: 42 },
    predecessors: [],
    ...overrides,
  };
}

Deno.test("round-trip: sign then verify succeeds", async () => {
  const { pubKey, privKey } = await generateKeypair();
  const event = makeEvent();
  const signed = await signEvent(event, privKey);
  const valid = await verifyEvent(signed, pubKey);
  assertEquals(valid, true);
});

Deno.test("tampered payload fails verify", async () => {
  const { pubKey, privKey } = await generateKeypair();
  const event = makeEvent();
  const signed = await signEvent(event, privKey);

  // Mutate payload after signing — hash should no longer match.
  const tampered = { ...signed, payload: { text: "evil", count: 0 } };
  const valid = await verifyEvent(tampered, pubKey);
  assertEquals(valid, false);
});

Deno.test("wrong pubkey fails verify", async () => {
  const { privKey } = await generateKeypair();
  const { pubKey: otherPubKey } = await generateKeypair();
  const event = makeEvent();
  const signed = await signEvent(event, privKey);
  const valid = await verifyEvent(signed, otherPubKey);
  assertEquals(valid, false);
});

Deno.test("canonical hash is stable across key order permutations", async () => {
  const base = makeEvent({
    payload: { z: 1, a: 2, m: 3 },
  });
  const permuted = makeEvent({
    payload: { m: 3, z: 1, a: 2 },
  });

  const hashA = await canonicalEventHash(base);
  const hashB = await canonicalEventHash(permuted);

  assertEquals(
    pubKeyToBase64(hashA),
    pubKeyToBase64(hashB),
    "Hash should be identical regardless of key order",
  );
});

Deno.test("canonical hash differs for different payloads", async () => {
  const a = await canonicalEventHash(makeEvent({ payload: { x: 1 } }));
  const b = await canonicalEventHash(makeEvent({ payload: { x: 2 } }));
  assertNotEquals(pubKeyToBase64(a), pubKeyToBase64(b));
});

Deno.test("base64 round-trip preserves bytes", async () => {
  const { pubKey } = await generateKeypair();
  const encoded = pubKeyToBase64(pubKey);
  const decoded = base64ToPubKey(encoded);
  assertEquals(pubKey, decoded);
});
