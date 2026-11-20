import { expect } from "@playwright/test";

import { acpRequest, promptOnce } from "../../acp.js";
import type { Person } from "../../people.js";
import type { World } from "../../world.js";
import type { OrderDriver } from "../driver.js";

/** UNIT_BOUNDARY_DESCRIPTION: the order a person's agents are shown in, from the order the api-server keeps for them: the agents it names in that order, then the others, oldest made first. It follows the web UI's own rule, since the API keeps only the stored order. */
async function shownAgents(
  person: Person,
): Promise<{ id: string; name: string }[]> {
  const [agents, stored] = await Promise.all([
    person.api.agents.list.query(),
    person.api.sidebarOrder.get.query(),
  ]);
  const rank = new Map(stored.agents.map((id, at) => [id, at]));
  const named = agents.filter((a) => rank.has(a.id));
  const rest = agents.filter((a) => !rank.has(a.id));
  named.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  rest.sort(
    (a, b) =>
      (a.createdAt ?? "").localeCompare(b.createdAt ?? "") ||
      a.id.localeCompare(b.id),
  );
  return [...named, ...rest];
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the order of a person's agents and of an agent's sessions over the public API: a move stores the whole list as the person sees it, as the web UI does, and sessions are listed by their last activity, newest first, from the agent's own list.
 */
export function apiOrder(world: World): OrderDriver {
  return {
    async expectAgents(person, names) {
      const wanted = new Set(names.map((n) => world.nameOf(n)));
      const shown = (await shownAgents(person))
        .map((a) => a.name)
        .filter((n) => wanted.has(n));
      expect(shown).toEqual(names.map((n) => world.nameOf(n)));
    },
    async move(person, name, where, target) {
      const ids = (await shownAgents(person)).map((a) => a.id);
      const moving = world.agent(name).id;
      const rest = ids.filter((id) => id !== moving);
      const at =
        rest.indexOf(world.agent(target).id) + (where === "after" ? 1 : 0);
      rest.splice(at, 0, moving);
      await person.api.sidebarOrder.setAgents.mutate({ agentIds: rest });
      world.undo.push(() =>
        person.api.sidebarOrder.setAgents.mutate({ agentIds: [] }),
      );
    },
    async openSessions(person, agentName) {
      world.note({
        step: "sessions opened",
        persona: person.persona,
        agentName,
      });
    },
    async sendIn(person, agentName, session, text) {
      const turn = await promptOnce(
        world.agent(agentName).id,
        await person.token(),
        world.unique(text),
        world.session(session).id,
      );
      world.note({ step: "turn in a session", agentName, session, turn });
    },
    async expectSessions(person, agentName, texts) {
      const titles = new Set(texts.map((t) => world.unique(t)));
      await expect
        .poll(
          async () => {
            const listed = await acpRequest(
              world.agent(agentName).id,
              await person.token(),
              "session/list",
              { cwd: "." },
            );
            return (
              (listed.sessions ?? []) as {
                sessionId: string;
                title?: string;
                updatedAt?: string;
                createdAt?: string;
              }[]
            )
              .sort(
                (a, b) =>
                  (b.updatedAt ?? b.createdAt ?? "").localeCompare(
                    a.updatedAt ?? a.createdAt ?? "",
                  ) || a.sessionId.localeCompare(b.sessionId),
              )
              .map((s) => s.title ?? "")
              .filter((t) => titles.has(t));
          },
          { timeout: 30_000 },
        )
        .toEqual(texts.map((t) => world.unique(t)));
    },
  };
}
