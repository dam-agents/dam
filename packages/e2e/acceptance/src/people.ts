import { expect } from "@playwright/test";

import { type Api, apiFor, tokenSource } from "./api.js";
import type { Account } from "./auth.js";
import { accountPassword, accountSlots, mockTemplateId } from "./config.js";

export const personas = ["Ada", "Ben", "Jo", "Kim"] as const;

/** UNIT_BOUNDARY_DESCRIPTION: the persona who has never accepted the Terms of Use: nothing in the suite accepts them for Kim. */
export const newcomer = "Kim";

const providerTemplateId = "openai";

export type Persona = (typeof personas)[number];

export interface Person {
  persona: Persona;
  account: Account;
  token: () => Promise<string>;
  api: Api;
  acceptedTerms: boolean;
}

export function accountOf(persona: Persona, slot: number): Account {
  if (slot >= accountSlots)
    throw new Error(
      `worker slot ${slot} has no accounts: the install provisions ${accountSlots} slots (helm/values-e2e.yaml)`,
    );
  return {
    username: `acceptance-${persona.toLowerCase()}-${slot}`,
    password: accountPassword,
  };
}

async function leaveNoAssistant(api: Api): Promise<void> {
  const deadline = Date.now() + 60_000;
  let state = await api.assistants.state.query();
  while ((state === null || !state.ready) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    state = await api.assistants.state.query();
  }
  if (state !== null) await api.agents.delete.mutate({ id: state.agentId });
}

function warmPrefix(persona: Persona): string {
  return `acceptance warm agent ${persona} `;
}

function warmMarker(persona: Persona, index: number): string {
  return `${warmPrefix(persona)}${index}`;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a persona of the examples, signed in as an account of its own worker slot. Kim, the newcomer, gets a token and nothing else, so the Terms gate stands for Kim in every example. Any other persona's first use in a worker accepts the Terms, stores the assistant off as the e2e suite's shared account does (01-auth.spec.ts), connects a model provider, which the web UI needs before it lets a person write to an Agent and which every Agent made afterwards gets as its default, and deletes every Agent but the warm ones its slot keeps across workers, so each example starts from an owner with nothing but what its Given steps make.
 */
export async function preparePerson(
  persona: Persona,
  slot: number,
): Promise<Person> {
  const account = accountOf(persona, slot);
  const token = tokenSource(account);
  const api = apiFor(token);
  if (persona === newcomer)
    return { persona, account, token, api, acceptedTerms: false };
  const terms = await api.terms.current.query();
  await api.terms.accept.mutate({ version: terms.version });
  await api.features.setFlag.mutate({ feature: "dambledore", enabled: false });
  await leaveNoAssistant(api);
  if (
    !(await api.connections.list.query()).some(
      (c) => c.templateId === providerTemplateId,
    )
  )
    await api.connections.create.mutate({
      templateId: providerTemplateId,
      name: providerTemplateId,
      authKind: "header",
      value: "sk-acceptance-dummy-key",
    });
  const isWarm = (description: string | undefined) =>
    description?.startsWith(warmPrefix(persona)) ?? false;
  for (const agent of await api.agents.list.query())
    if (!isWarm(agent.description))
      await api.agents.delete.mutate({ id: agent.id });
  await expect
    .poll(
      async () =>
        (await api.agents.list.query()).filter((a) => !isWarm(a.description))
          .length,
      {
        timeout: 120_000,
        intervals: [2_000],
        message: `${account.username} still owns Agents from an earlier run`,
      },
    )
    .toBe(0);
  return { persona, account, token, api, acceptedTerms: true };
}

export async function warmMockAgent(
  person: Person,
  index: number,
): Promise<string> {
  const marker = warmMarker(person.persona, index);
  const kept = (await person.api.agents.list.query()).find(
    (a) => a.description === marker,
  );
  const created =
    kept ??
    (await person.api.agents.create.mutate({
      name: `warm-${person.account.username}-${index}`,
      description: marker,
      templateId: mockTemplateId,
    }));
  if (kept !== undefined && kept.state !== "running")
    await person.api.agents.wake.mutate({ id: kept.id });
  const name = created.name;
  await expect
    .poll(
      async () => (await person.api.agents.get.query({ id: created.id })).state,
      {
        timeout: 240_000,
        intervals: [250, 500, 1_000],
        message: `${person.persona}'s Agent ${name} did not reach running`,
      },
    )
    .toBe("running");
  return created.id;
}

/** UNIT_BOUNDARY_DESCRIPTION: the knowledge base a persona's slot keeps booted across examples, which shares its folder "wiki": a knowledge base's share roots are fixed when it is made, so one made per example would boot a machine each time. */
export async function warmKnowledgeBase(person: Person): Promise<string> {
  const marker = `${warmPrefix(person.persona)}kb`;
  const kept = (await person.api.agents.list.query()).find(
    (a) => a.description === marker,
  );
  const id =
    kept?.id ??
    (
      await person.api.agents.create.mutate({
        name: `kb-${person.account.username}`,
        description: marker,
        templateId: mockTemplateId,
        kbShareRoots: ["wiki"],
      })
    ).id;
  return id;
}
