import { expect, test } from "@playwright/test";

import { acpRequest } from "../../acp.js";
import type { Person } from "../../people.js";
import type { World } from "../../world.js";
import type { SessionsDriver } from "../driver.js";

async function titles(
  world: World,
  person: Person,
  agentName: string,
): Promise<string[]> {
  const listed = await acpRequest(
    world.agent(agentName).id,
    await person.token(),
    "session/list",
    { cwd: "." },
  );
  return ((listed.sessions ?? []) as { title?: string }[]).map(
    (s) => s.title ?? "",
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: an agent's sessions through its ACP relay, as every client lists and deletes them: `session/list` and `platform/deleteSession`. Which session a client keeps open is the client's own, so the API surface skips it.
 */
export function apiSessions(world: World): SessionsDriver {
  return {
    async expectListed(person, agentName, text, listed) {
      const title = world.unique(text);
      await expect
        .poll(
          async () => (await titles(world, person, agentName)).includes(title),
          {
            timeout: 30_000,
            message: `the sessions of ${agentName} ${listed ? "never list" : "still list"} "${title}"`,
          },
        )
        .toBe(listed);
    },
    async remove(person, agentName, text) {
      await acpRequest(
        world.agent(agentName).id,
        await person.token(),
        "platform/deleteSession",
        { sessionId: world.session(text).id },
      );
      world.note({ step: "session deleted", agentName, text });
    },
    async expectStillOpen() {
      test.skip(true, "which session is open is the web UI's");
    },
  };
}
