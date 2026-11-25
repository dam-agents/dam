import { expect } from "@playwright/test";

import { promptOnce } from "./acp.js";
import type { Person } from "./people.js";
import type { World } from "./world.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: what an agent holds and sends, asked of the agent itself whatever surface the example runs on: the mock answers a directive with the value of a variable in its harness process, or with what a request it sends got back. The sessions these turns open are deleted when the example ends.
 */
export async function untilAgentAnswers(
  world: World,
  person: Person,
  agentName: string,
  directive: string,
  expected: string,
): Promise<void> {
  const { id } = world.agent(agentName);
  let last = "";
  await expect
    .poll(
      async () => {
        const turn = await promptOnce(
          id,
          await person.token(),
          directive,
        ).catch((error: unknown) => ({ reply: String(error), sessionId: "" }));
        if (turn.sessionId !== "")
          world.opened(person.persona, agentName, directive, turn.sessionId);
        last = turn.reply;
        return turn.reply.includes(expected);
      },
      {
        timeout: 120_000,
        intervals: [5_000],
        message: `${agentName} never answered "${directive}" with "${expected}"`,
      },
    )
    .toBe(true);
  world.note({ step: "agent answered", agentName, directive, last });
}

/** UNIT_BOUNDARY_DESCRIPTION: waits until the agent's runtime holds a variable at the value given, the environment every harness process of the agent starts with. A change of values only waits for the agent to be idle before the running harness takes it, so the runtime, not the running process, is what an example reads. */
export async function untilAgentHolds(
  world: World,
  person: Person,
  agentName: string,
  name: string,
  value: string,
): Promise<void> {
  const { id } = world.agent(agentName);
  await expect
    .poll(
      async () =>
        (
          await person.api.e2e.getEnv
            .query({ agentId: id, name })
            .catch(() => undefined)
        )?.value ?? null,
      {
        timeout: 120_000,
        intervals: [2_000],
        message: `${agentName} never held ${name} as "${value}"`,
      },
    )
    .toBe(value);
}
