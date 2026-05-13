import { assertEquals } from "@std/assert";

import { derivePeerId, resolveAuthenticatedPeer } from "../src/auth.ts";

Deno.test("derivePeerId computes deterministic SHA-256 hash", async () => {
  const first = await derivePeerId("oid-1", "device-1");
  const second = await derivePeerId("oid-1", "device-1");
  const other = await derivePeerId("oid-1", "device-2");

  assertEquals(first.length, 64);
  assertEquals(first, second);
  if (first === other) {
    throw new Error(
      "Expected different device IDs to produce different peer IDs.",
    );
  }
});

Deno.test("resolveAuthenticatedPeer is disabled when AUTH_ENABLED is false", async () => {
  Deno.env.set("AUTH_ENABLED", "false");
  const request = new Request("https://example.com/sync?room=test");
  const result = await resolveAuthenticatedPeer(request, new URL(request.url));
  assertEquals(result, undefined);
});
