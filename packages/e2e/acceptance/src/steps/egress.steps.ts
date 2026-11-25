import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";

import { requestOf, ruleOf } from "../egress.js";
import { test } from "../fixtures.js";
import type { Persona } from "../people.js";
import type { World } from "../world.js";

const { Given, When, Then } = createBdd(test);

function heldAgent(world: World): string {
  const [agent] = world.held.keys();
  if (agent === undefined) throw new Error("no agent holds a request");
  return agent;
}

Given(
  "{word} has allowed {string} requests to {string} for {string}",
  async (
    { setup },
    persona: Persona,
    method: string,
    pattern: string,
    agent: string,
  ) => setup.rule(persona, agent, { method, ...ruleOf(pattern) }, "allow"),
);

Given(
  "{word} has denied {string} requests to {string} for {string}",
  async (
    { setup },
    persona: Persona,
    method: string,
    pattern: string,
    agent: string,
  ) => setup.rule(persona, agent, { method, ...ruleOf(pattern) }, "deny"),
);

Given(
  "{word} has network approvals in the chat turned on",
  async ({ setup }, persona: Persona) =>
    setup.flag(persona, "chat-network-approvals"),
);

Given(
  "{string} is waiting for {word}'s verdict on {string}",
  async ({ setup }, agent: string, _persona: Persona, request: string) =>
    setup.hold(agent, request.split(/\s+/)[1]!, 1),
);

Given(
  "{string} has requested {string} twice, waiting for {word}'s verdict",
  async ({ setup }, agent: string, url: string, _persona: Persona) =>
    setup.hold(agent, url, 2),
);

When(
  "{word} allows {string} requests to {string} for {string}",
  async (
    { driver, person },
    persona: Persona,
    method: string,
    pattern: string,
    agent: string,
  ) => {
    const { host, pathPattern } = ruleOf(pattern);
    await driver.egress.allow(
      await person(persona),
      agent,
      method,
      host,
      pathPattern,
    );
  },
);

When(
  "{word} allows that request once",
  async ({ driver, person, world }, persona: Persona) =>
    driver.egress.answer(await person(persona), heldAgent(world), "once"),
);

When(
  "{word} always allows that request",
  async ({ driver, person, world }, persona: Persona) =>
    driver.egress.answer(await person(persona), heldAgent(world), "always"),
);

When(
  "{word} opens the chat with {string}",
  async ({ driver, person }, persona: Persona, agent: string) =>
    driver.egress.openChat(await person(persona), agent),
);

When(
  "{word} allows that request once in the chat with {string}",
  async ({ driver, person }, persona: Persona, agent: string) =>
    driver.egress.answerOnceInChat(await person(persona), agent),
);

Then(
  "{word} sees {string} allowed {string} requests to {string}",
  async (
    { driver, person },
    persona: Persona,
    agent: string,
    method: string,
    pattern: string,
  ) =>
    driver.egress.expectRule(
      await person(persona),
      agent,
      { method, ...ruleOf(pattern), verdict: "allow" },
      true,
    ),
);

Then(
  "{word} sees no rule of {string} for {string}",
  async (
    { driver, person },
    persona: Persona,
    agent: string,
    request: string,
  ) => {
    const { method, host, path } = requestOf(request);
    await driver.egress.expectRule(
      await person(persona),
      agent,
      { method, host, pathPattern: path, verdict: "allow" },
      false,
    );
  },
);

Then(
  "{word} sees no rule of {string} for all of {string}",
  async ({ driver, person }, persona: Persona, agent: string, host: string) =>
    driver.egress.expectRule(
      await person(persona),
      agent,
      { method: "*", host, pathPattern: "*", verdict: "allow" },
      false,
    ),
);

Then(
  "{word} sees a waiting network approval of {string} for {string}",
  async (
    { driver, person },
    persona: Persona,
    agent: string,
    request: string,
  ) =>
    driver.egress.expectWaiting(
      await person(persona),
      agent,
      requestOf(request),
    ),
);

Then(
  "{word} sees no waiting network approval of {string}",
  async ({ driver, person }, persona: Persona, agent: string) =>
    driver.egress.expectWaiting(await person(persona), agent, undefined),
);

Then(
  "{word} sees in the chat that {string} waits for {string}",
  async (
    { driver, person },
    persona: Persona,
    agent: string,
    request: string,
  ) =>
    driver.egress.expectWaitingInChat(
      await person(persona),
      agent,
      requestOf(request),
    ),
);

Then(
  "the waiting request of {string} gets status {int}",
  async ({ world }, agent: string, status: number) => {
    const held = world.held.get(agent);
    expect(held, `${agent} holds no request`).toBeDefined();
    expect(await held!.results[0]).toBe(status);
  },
);

Then(
  "both requests of {string} get status {int}",
  async ({ world }, agent: string, status: number) => {
    const held = world.held.get(agent);
    expect(held, `${agent} holds no request`).toBeDefined();
    expect(await Promise.all(held!.results)).toEqual([status, status]);
  },
);

Then(
  "{word} sees that {string} was refused by the rule denying {string} requests to {string}",
  async (
    { driver, person },
    persona: Persona,
    agent: string,
    method: string,
    pattern: string,
  ) => {
    const { host, pathPattern } = ruleOf(pattern);
    const owner = await person(persona);
    await driver.chat.expectAnswer(owner, agent, "Blocked by network rule");
    await driver.chat.expectAnswer(
      owner,
      agent,
      `deny ${host}, method ${method}, path ${pathPattern}`,
    );
  },
);
