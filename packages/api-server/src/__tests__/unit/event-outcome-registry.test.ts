import { describe, expect, test } from "vitest";
import { createEventOutcomeRegistry } from "../../modules/runtime-delivery/services/event-outcome-registry.js";

// TEST_OVERVIEW: The registry collects the reactions to an event report, several per event kind, and dispatches them as one handler. Every reaction runs, whatever the ones before it did: the event report is already claimed when they run, so a reaction lost to another one's failure is never reported again.

const event = { agentId: "agent-1" } as never;
const report = { eventId: "e-1", outcome: "failed" } as never;

describe("event outcome registry", () => {
  test("every handler of the kind runs, in registration order", async () => {
    const ran: string[] = [];
    const registry = createEventOutcomeRegistry({ log: () => {} });
    registry.add("workspace-seed", async () => {
      ran.push("hint");
    });
    registry.add("workspace-seed", async () => {
      ran.push("invocation");
    });

    await registry.dispatch("workspace-seed")!(event, report);

    expect(ran).toEqual(["hint", "invocation"]);
  });

  // TEST_SCENARIO: the hint handler emits to an RxJS subject, so a throwing subscriber propagates into the fan-out. The invocation's setup-failure handler must still run, or a failed seed leaves the Invocation waiting out its whole deadline.
  test("a throwing handler does not cancel the handlers after it", async () => {
    const ran: string[] = [];
    const logged: string[] = [];
    const registry = createEventOutcomeRegistry({
      log: (msg) => logged.push(msg),
    });
    registry.add("workspace-command", async () => {
      throw new Error("subscriber raised");
    });
    registry.add("workspace-command", async () => {
      ran.push("invocation");
    });

    await registry.dispatch("workspace-command")!(event, report);

    expect(ran).toEqual(["invocation"]);
    expect(logged).toEqual([
      "agent-1: workspace-command outcome handler failed: subscriber raised",
    ]);
  });

  test("a kind nothing registered for dispatches nothing", () => {
    const registry = createEventOutcomeRegistry({ log: () => {} });

    expect(registry.dispatch("harness-config")).toBeUndefined();
  });
});
