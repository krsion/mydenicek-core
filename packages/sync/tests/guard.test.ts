import { assertEquals } from "@std/assert";
import type {
  PeerKey,
  SignedEvent,
  UnsignedEvent,
} from "@mydenicek/shared-types";
import { generateKeypair, pubKeyToBase64, signEvent } from "@mydenicek/crypto";

import { validateInboundSignedEvents } from "../src/guard.ts";
import type { AclClient } from "../src/acl-client.ts";

Deno.test("guard passes payload through when auth is disabled", async () => {
  Deno.env.set("AUTH_ENABLED", "false");
  const signedEvent: SignedEvent = {
    docId: "doc-1",
    author: "peer-1",
    payload: { id: { peer: "p", seq: 1 }, parents: [], edit: {}, clock: {} },
    predecessors: [],
    hash: "h",
    signature: "s",
  };
  const events = await validateInboundSignedEvents({
    acl: {
      getPeerKey: async () => null,
      getRole: async () => "editor",
    },
    connection: {
      docId: "doc-1",
      oid: "oid",
      peerId: "peer-1",
      role: "editor",
    },
    signedEvents: [signedEvent],
    onPolicyViolation: () => {},
  });
  assertEquals(events.length, 1);
});

Deno.test("guard verifies signatures when auth is enabled", async () => {
  Deno.env.set("AUTH_ENABLED", "true");
  const { pubKey, privKey } = await generateKeypair();
  const unsignedEvent: UnsignedEvent = {
    docId: "doc-2",
    author: "peer-2",
    payload: { id: { peer: "p", seq: 1 }, parents: [], edit: {}, clock: {} },
    predecessors: [],
  };
  const signedEvent = await signEvent(unsignedEvent, privKey);
  const peerKey: PeerKey = {
    oid: "oid",
    deviceGuid: "device",
    pubKey: pubKeyToBase64(pubKey),
    createdAt: new Date().toISOString(),
  };
  const aclClient: AclClient = {
    getPeerKey: async () => peerKey,
    getRole: async () => "editor",
  };

  const events = await validateInboundSignedEvents({
    acl: aclClient,
    connection: {
      docId: "doc-2",
      oid: "oid",
      peerId: "peer-2",
      role: "editor",
    },
    signedEvents: [signedEvent],
    onPolicyViolation: () => {},
  });
  assertEquals(events.length, 1);
});

Deno.test("guard rejects invalid signature when auth is enabled", async () => {
  Deno.env.set("AUTH_ENABLED", "true");
  const { pubKey } = await generateKeypair();
  const peerKey: PeerKey = {
    oid: "oid",
    deviceGuid: "device",
    pubKey: pubKeyToBase64(pubKey),
    createdAt: new Date().toISOString(),
  };
  const signedEvent: SignedEvent = {
    docId: "doc-3",
    author: "peer-3",
    payload: { id: { peer: "p", seq: 1 }, parents: [], edit: {}, clock: {} },
    predecessors: [],
    hash: "ZmFrZQ==",
    signature: "ZmFrZQ==",
  };

  let failed = false;
  try {
    await validateInboundSignedEvents({
      acl: {
        getPeerKey: async () => peerKey,
        getRole: async () => "editor",
      },
      connection: {
        docId: "doc-3",
        oid: "oid",
        peerId: "peer-3",
        role: "editor",
      },
      signedEvents: [signedEvent],
      onPolicyViolation: () => {},
    });
  } catch {
    failed = true;
  }
  assertEquals(failed, true);
});
