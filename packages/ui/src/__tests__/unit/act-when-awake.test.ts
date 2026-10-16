// TEST_OVERVIEW: Rename or Delete chosen on a session row while its agent cannot answer, such as a provisional row of a sleeping agent, wakes the agent and runs once the agent answers. An agent already starting is not woken again, the same action asked twice while it waits runs once, and an agent that stops before it answers runs nothing and says so.
import { expect, it } from "vitest";

import { actWhenAwake } from "../../modules/agents/lib/agent-start.js";

function harness({
  operable = false,
  starting = false,
}: { operable?: boolean; starting?: boolean } = {}) {
  const log: string[] = [];
  let settle: { resolve: () => void; reject: (e: Error) => void } | null = null;
  let hold: Promise<void> | null = null;
  const startHold = () => {
    hold = new Promise<void>((resolve, reject) => {
      settle = { resolve, reject };
    });
  };
  if (starting) startHold();
  const inFlight = new Set<string>();
  const run = (key = "rename:s1") =>
    actWhenAwake({
      inFlight,
      key,
      operable,
      wake: () => {
        log.push("wake");
        startHold();
      },
      untilOperable: () => hold,
      onWaiting: () => log.push("waiting"),
      onFailed: () => log.push("failed"),
      act: () => log.push("act"),
    });
  return {
    log,
    run,
    answer: () => settle!.resolve(),
    stop: () => settle!.reject(new Error("stopped")),
  };
}

it("TEST_SCENARIO: an awake agent runs the action at once, without a wake", async () => {
  const h = harness({ operable: true });
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
  const h = harness({ starting: true });
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

it("TEST_SCENARIO: a wake that never starts the agent runs nothing", async () => {
  const log: string[] = [];
  await actWhenAwake({
    inFlight: new Set(),
    key: "delete:s1",
    operable: false,
    wake: () => log.push("wake"),
    untilOperable: () => null,
    onWaiting: () => log.push("waiting"),
    onFailed: () => log.push("failed"),
    act: () => log.push("act"),
  });
  expect(log).toEqual(["wake", "failed"]);
});
