// TEST_OVERVIEW: Rename or Delete chosen on a session row while its agent cannot answer, such as a provisional row of a sleeping agent, wakes the agent and runs once the agent answers. An agent already starting is not woken again, the same action asked twice while it waits runs once, and an agent that stops before it answers runs nothing and says so.
import { expect, it } from "vitest";

import {
  actWhenAwake,
  type AgentReadiness,
} from "../../modules/agents/lib/agent-start.js";

function harness(initial: AgentReadiness = "down") {
  const log: string[] = [];
  let now = initial;
  let settle: { resolve: () => void; reject: (e: Error) => void } | null = null;
  const inFlight = new Set<string>();
  const run = (key = "rename:s1") =>
    actWhenAwake({
      inFlight,
      key,
      readiness: () => now,
      wake: () => {
        log.push("wake");
        now = "starting";
      },
      untilOperable: () =>
        now === "starting"
          ? new Promise<void>((resolve, reject) => {
              settle = { resolve, reject };
            })
          : null,
      onWaiting: () => log.push("waiting"),
      onFailed: () => log.push("failed"),
      act: () => log.push("act"),
    });
  return {
    log,
    run,
    set: (next: AgentReadiness) => {
      now = next;
    },
    answer: () => {
      now = "ready";
      settle!.resolve();
    },
    stop: () => {
      now = "down";
      settle!.reject(new Error("stopped"));
    },
  };
}

it("TEST_SCENARIO: an awake agent runs the action at once, without a wake", async () => {
  const h = harness("ready");
  await h.run();
  expect(h.log).toEqual(["act"]);
});

it("TEST_SCENARIO: a sleeping agent is woken, and the action runs once it answers", async () => {
  const h = harness();
  const done = h.run();
  expect(h.log).toEqual(["wake", "waiting"]);
  h.answer();
  await done;
  expect(h.log).toEqual(["wake", "waiting", "act"]);
});

it("TEST_SCENARIO: an agent already starting is not woken again", async () => {
  const h = harness("starting");
  const done = h.run();
  h.answer();
  await done;
  expect(h.log).toEqual(["waiting", "act"]);
});

it("TEST_SCENARIO: the same action chosen twice while the agent wakes runs once", async () => {
  const h = harness();
  const first = h.run();
  const second = h.run();
  h.answer();
  await Promise.all([first, second]);
  expect(h.log.filter((e) => e === "act")).toHaveLength(1);
  expect(h.log.filter((e) => e === "wake")).toHaveLength(1);
});

it("TEST_SCENARIO: an agent that stops before it answers runs nothing", async () => {
  const h = harness();
  const done = h.run();
  h.stop();
  await done;
  expect(h.log).toEqual(["wake", "waiting", "failed"]);
});

it("TEST_SCENARIO: an agent that woke after the menu opened runs the action at once", async () => {
  const h = harness("down");
  h.set("ready");
  await h.run("delete:s1");
  expect(h.log).toEqual(["act"]);
});

it("TEST_SCENARIO: a wake that never starts the agent runs nothing", async () => {
  const log: string[] = [];
  await actWhenAwake({
    inFlight: new Set(),
    key: "delete:s1",
    readiness: () => "down",
    wake: () => log.push("wake"),
    untilOperable: () => null,
    onWaiting: () => log.push("waiting"),
    onFailed: () => log.push("failed"),
    act: () => log.push("act"),
  });
  expect(log).toEqual(["wake", "failed"]);
});
