import { base64ToPubKey, verifyEvent } from "@mydenicek/crypto";
import type { SignedEvent } from "@mydenicek/shared-types";

import type { EncodedEvent } from "../protocol.ts";
import type { AclClient } from "./acl-client.ts";
import { type ConnectionIdentity, isAuthEnabled } from "./auth.ts";

interface TokenBucketState {
  secondTokens: number;
  minuteTokens: number;
  lastSecondRefillAt: number;
  lastMinuteRefillAt: number;
}

interface GuardContext {
  acl: AclClient;
  connection: ConnectionIdentity;
  signedEvents: SignedEvent[];
  onPolicyViolation(message: string): void;
}

const secondRate = 50;
const minuteRate = 500;
const secondMs = 1000;
const minuteMs = 60_000;
const buckets = new Map<string, TokenBucketState>();

function consumeRateLimit(peerId: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(peerId) ?? {
    secondTokens: secondRate,
    minuteTokens: minuteRate,
    lastSecondRefillAt: now,
    lastMinuteRefillAt: now,
  };

  const secondElapsed = Math.floor(
    (now - bucket.lastSecondRefillAt) / secondMs,
  );
  if (secondElapsed > 0) {
    bucket.secondTokens = Math.min(
      secondRate,
      bucket.secondTokens + secondElapsed * secondRate,
    );
    bucket.lastSecondRefillAt = now;
  }

  const minuteElapsed = Math.floor(
    (now - bucket.lastMinuteRefillAt) / minuteMs,
  );
  if (minuteElapsed > 0) {
    bucket.minuteTokens = Math.min(
      minuteRate,
      bucket.minuteTokens + minuteElapsed * minuteRate,
    );
    bucket.lastMinuteRefillAt = now;
  }

  if (bucket.secondTokens < 1 || bucket.minuteTokens < 1) {
    buckets.set(peerId, bucket);
    return false;
  }

  bucket.secondTokens -= 1;
  bucket.minuteTokens -= 1;
  buckets.set(peerId, bucket);
  return true;
}

export function mapSignedPayloadToEncodedEvents(
  events: SignedEvent[],
): EncodedEvent[] {
  return events.map((event) => event.payload as EncodedEvent);
}

export async function validateInboundSignedEvents(
  context: GuardContext,
): Promise<EncodedEvent[]> {
  if (!isAuthEnabled()) {
    return mapSignedPayloadToEncodedEvents(context.signedEvents);
  }

  if (context.connection.role === "viewer") {
    context.onPolicyViolation("Viewers cannot publish events.");
    throw new Error("Viewer role cannot write.");
  }

  const validatedEvents: EncodedEvent[] = [];
  for (const signedEvent of context.signedEvents) {
    if (signedEvent.docId !== context.connection.docId) {
      throw new Error("Inbound event docId does not match socket docId.");
    }

    signedEvent.author = context.connection.peerId;

    const peerKey = await context.acl.getPeerKey(context.connection.peerId);
    if (!peerKey) {
      throw new Error("No public key registered for peer.");
    }

    if (
      peerKey.revokedAt !== undefined &&
      Date.now() > Date.parse(peerKey.revokedAt)
    ) {
      throw new Error("Peer key has been revoked.");
    }

    const isValidSignature = await verifyEvent(
      signedEvent,
      base64ToPubKey(peerKey.pubKey),
    );
    if (!isValidSignature) {
      throw new Error("Invalid event signature.");
    }

    if (!consumeRateLimit(context.connection.peerId)) {
      context.onPolicyViolation("Rate limit exceeded.");
      throw new Error("Rate limit exceeded.");
    }

    validatedEvents.push(signedEvent.payload as EncodedEvent);
  }

  return validatedEvents;
}
