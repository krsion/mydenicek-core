import { assertEquals } from "@std/assert";
import { CausalStabilityTracker } from "../../core/causal-stability.ts";
import { Event } from "../../core/event.ts";
import { EventId } from "../../core/event-id.ts";
import { VectorClock } from "../../core/vector-clock.ts";
import { RecordAddEdit } from "../../core/edits/record-edits.ts";
import { Selector } from "../../core/selector.ts";
import { PrimitiveNode } from "../../core/nodes.ts";

function makeEvent(peer: string, seq: number): Event {
  const id = new EventId(peer, seq);
  const clock = new VectorClock({ [peer]: seq });
  const edit = new RecordAddEdit(
    Selector.parse("test"),
    new PrimitiveNode("v"),
  );
  return new Event(id, [], edit, clock);
}

Deno.test("stability: no peers means nothing is stable", () => {
  const tracker = new CausalStabilityTracker();
  const event = makeEvent("alice", 0);
  assertEquals(tracker.isCausallyStable(event), false);
});

Deno.test("stability: single remote peer acknowledges event", () => {
  const tracker = new CausalStabilityTracker();
  const event = makeEvent("alice", 0);

  // Bob reports he has seen alice:0
  tracker.updateRemoteClock("bob", new VectorClock({ alice: 0 }));
  assertEquals(tracker.isCausallyStable(event), true);
});

Deno.test("stability: event not yet seen by all peers", () => {
  const tracker = new CausalStabilityTracker();
  const event = makeEvent("alice", 1);

  // Bob has seen alice:0 but not alice:1
  tracker.updateRemoteClock("bob", new VectorClock({ alice: 0 }));
  tracker.updateRemoteClock("carol", new VectorClock({ alice: 1 }));
  assertEquals(tracker.isCausallyStable(event), false);

  // Now Bob catches up
  tracker.updateRemoteClock("bob", new VectorClock({ alice: 1 }));
  assertEquals(tracker.isCausallyStable(event), true);
});

Deno.test("stability: removing a peer invalidates stable set", () => {
  const tracker = new CausalStabilityTracker();
  const event = makeEvent("alice", 0);

  tracker.updateRemoteClock("bob", new VectorClock({ alice: 0 }));
  assertEquals(tracker.isCausallyStable(event), true);

  // Bob disconnects — we can't assume stability anymore
  tracker.removePeer("bob");
  assertEquals(tracker.isCausallyStable(event), false);
});

Deno.test("stability: replay references prevent pruning", () => {
  const tracker = new CausalStabilityTracker();
  const event = makeEvent("alice", 0);

  tracker.updateRemoteClock("bob", new VectorClock({ alice: 0 }));
  assertEquals(tracker.isCausallyStable(event), true);
  assertEquals(tracker.canPrune(event), true);

  // Mark as replay reference
  tracker.addReplayReference("alice:0");
  assertEquals(tracker.isCausallyStable(event), true); // still stable
  assertEquals(tracker.canPrune(event), false); // but can't prune

  // Remove replay reference
  tracker.removeReplayReference("alice:0");
  assertEquals(tracker.canPrune(event), true);
});

Deno.test("stability: findPrunableEvents filters correctly", () => {
  const tracker = new CausalStabilityTracker();
  const e0 = makeEvent("alice", 0);
  const e1 = makeEvent("alice", 1);
  const e2 = makeEvent("bob", 0);

  const events = new Map<string, Event>();
  events.set("alice:0", e0);
  events.set("alice:1", e1);
  events.set("bob:0", e2);

  // Bob has seen alice:0 but not alice:1; alice has seen bob:0
  tracker.updateRemoteClock("bob", new VectorClock({ alice: 0, bob: 0 }));
  tracker.updateRemoteClock("alice", new VectorClock({ alice: 1, bob: 0 }));

  // alice:0 and bob:0 are stable (both peers have seen them)
  // alice:1 is NOT stable (bob hasn't seen it)
  tracker.addReplayReference("bob:0"); // bob:0 is replay-referenced

  const prunable = tracker.findPrunableEvents(events);
  const prunableIds = prunable.map((e) => e.id.format()).sort();
  assertEquals(prunableIds, ["alice:0"]); // only alice:0 is prunable
});

Deno.test("stability: remote clock merge takes max", () => {
  const tracker = new CausalStabilityTracker();

  tracker.updateRemoteClock("bob", new VectorClock({ alice: 2 }));
  tracker.updateRemoteClock("bob", new VectorClock({ alice: 1 })); // older, should not regress

  const event = makeEvent("alice", 2);
  assertEquals(tracker.isCausallyStable(event), true); // still knows alice:2
});
