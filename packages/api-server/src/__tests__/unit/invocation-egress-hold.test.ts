// TEST_OVERVIEW: a one-off sub-agent does not start its work while a network rule its driver set at launch waits for the owner: its task is left out of delivery until every such rule is answered, a kept sub-agent's task is delivered at once, and no other event is touched.
import { describe, expect, it } from "vitest";

import { createInvocationEgressHold } from "../../modules/invocations/services/invocation-egress-hold.js";

function setup(opts: { kept: boolean; waiting: number }) {
  const state = { waiting: opts.waiting };
  const hold = createInvocationEgressHold({
    repo: {
      find: async () => ({ keepUntil: opts.kept ? new Date() : null }) as never,
    },
    waitingRules: async () => Array.from({ length: state.waiting }),
  });
  return { hold, state };
}

const task = { id: "run-1", kind: "invocation-script", payload: {} };
const prompt = { id: "run-1", kind: "trigger", payload: { invocation: true } };
const other = { id: "e-1", kind: "workspace-seed", payload: {} };

describe("the launch hold of a one-off sub-agent", () => {
  // TEST_SCENARIO: the driver launched a one-off sub-agent with two rules that wait for the owner. Its script and its prompt are both left out of delivery while one waits, and delivered once the owner has answered them all; an event that is not its task is delivered meanwhile, so the machine is still set up.
  it("leaves the task out until every waiting rule is answered", async () => {
    const { hold, state } = setup({ kept: false, waiting: 2 });
    expect(await hold("agent-child", task)).toBeNull();
    expect(await hold("agent-child", prompt)).toBeNull();
    expect(await hold("agent-child", other)).toBe(other);
    state.waiting = 1;
    expect(await hold("agent-child", task)).toBeNull();
    state.waiting = 0;
    expect(await hold("agent-child", task)).toBe(task);
  });

  // TEST_SCENARIO: a kept sub-agent runs many times, so its work is not held for a rule that waits; a request that rule would allow waits at the egress gate instead.
  it("does not hold a kept sub-agent's task", async () => {
    const { hold } = setup({ kept: true, waiting: 2 });
    expect(await hold("agent-child", task)).toBe(task);
  });
});
