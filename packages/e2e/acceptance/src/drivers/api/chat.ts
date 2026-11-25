import { expect } from "@playwright/test";

import { promptWhenSettled, type Turn } from "../../acp.js";
import type { World } from "../../world.js";
import type { ChatDriver } from "../driver.js";

export function apiChat(world: World): ChatDriver {
  const turns = new Map<string, Turn>();
  return {
    async send(person, name, text, verbatim = false) {
      const agent = world.agent(name);
      const turn = await promptWhenSettled(
        agent.id,
        await person.token(),
        verbatim ? text : world.unique(text),
      );
      world.note({ step: "acp turn", agent: agent.name, turn });
      world.opened(person.persona, name, text, turn.sessionId);
      turns.set(`${person.persona}/${name}`, turn);
    },
    async expectAnswerWithout(person, name, text) {
      const turn = turns.get(`${person.persona}/${name}`);
      expect(turn, `${person.persona} sent nothing to ${name}`).toBeDefined();
      expect(turn!.reply).not.toContain(text);
    },
    async expectAnswer(person, name, text) {
      const turn = turns.get(`${person.persona}/${name}`);
      expect(turn, `${person.persona} sent nothing to ${name}`).toBeDefined();
      if (text === undefined) expect(turn!.reply).not.toBe("");
      else expect(turn!.reply).toContain(text);
      expect(turn!.stopReason).toBe("end_turn");
    },
  };
}
