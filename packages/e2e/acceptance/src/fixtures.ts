import { mkdirSync } from "node:fs";

import { type Browser, expect, type Page } from "@playwright/test";
import { test as base } from "playwright-bdd";
import {
  connectionEgressPlaceholder,
  E2E_PERFORM_FETCH_MAX_TIMEOUT_MS,
} from "api-server-api";

import { acpRequest, promptOnce, promptWhenSettled } from "./acp.js";
import { browserControl, watchBrowser } from "./browser.js";
import { signInThroughTheBrowser } from "./auth.js";
import { mockTemplateId } from "./config.js";
import { requestOf, waitingApprovals } from "./egress.js";
import { agentFiles } from "./kb.js";
import { apiDriver } from "./drivers/api/index.js";
import type { Driver, Surface } from "./drivers/driver.js";
import { uiDriver } from "./drivers/ui/index.js";
import type { Pages } from "./drivers/ui/pages.js";
import {
  type Persona,
  type Person,
  personas,
  preparePerson,
  warmKnowledgeBase,
  warmMockAgent,
} from "./people.js";
import { customHeader, World } from "./world.js";

export type { Surface } from "./drivers/driver.js";

const mockReplyEnv = "MOCK_DEFAULT_REPLY";
const mockToolEnv = "MOCK_TOOL_CALL";
const mockShellEnv = "MOCK_SHELL";

interface Cast {
  person(persona: Persona): Promise<Person>;
  storageState(persona: Persona): Promise<string>;
  warmAgent(persona: Persona, index: number): Promise<string>;
  forgetWarm(persona: Persona, id: string): void;
  warmKnowledgeBase(persona: Persona): Promise<string>;
}

interface Setup {
  connection(
    persona: Persona,
    name: string,
    kind:
      | { host: string; variable?: boolean; key?: string; envName?: string }
      | { provider: "openai" },
  ): Promise<void>;
  allowAll(persona: Persona, host: string, agent: string): Promise<void>;
  rule(
    persona: Persona,
    agent: string,
    rule: { method: string; host: string; pathPattern: string },
    verdict: "allow" | "deny",
  ): Promise<void>;
  hold(agent: string, url: string, times: number): Promise<void>;
  flag(persona: Persona, feature: "chat-network-approvals"): Promise<void>;
  grant(persona: Persona, connection: string, agent: string): Promise<void>;
  agent(persona: Persona, name: string): Promise<void>;
  sleep(agent: string): Promise<void>;
  knowledgeBase(persona: Persona, name: string, folder: string): Promise<void>;
  freshBrowser(agent: string): Promise<void>;
  browserTabs(agent: string, titles: string[], front: string): Promise<void>;
  closedTab(agent: string, title: string): Promise<void>;
  session(persona: Persona, agent: string, text: string): Promise<void>;
  runningAgent(
    persona: Persona,
    name: string,
    behaviour?: {
      answer?: string;
      publishes?: string;
      calls?: { name: string; arguments: Record<string, unknown> };
      shell?: string;
      requiresNaming?: boolean;
    },
  ): Promise<void>;
}

async function signIn(
  browser: Browser,
  person: Person,
  path: string,
): Promise<string> {
  const context = await browser.newContext();
  try {
    await signInThroughTheBrowser(
      await context.newPage(),
      person.account,
      person.acceptedTerms,
    );
    await context.storageState({ path });
  } finally {
    await context.close();
  }
  return path;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the fixtures every example and journey runs on. A worker owns the accounts of its parallel slot and signs each persona in once. The slot keeps booted mock Agents per persona, marked by their description, which the Given steps rename and script and later workers of the slot wake and reuse, so an example costs seconds instead of a machine boot. A Given step scripts an Agent through its environment, which every harness process the mock starts reads: its answer, `MOCK_DEFAULT_REPLY`, and a platform tool it calls on every turn, `MOCK_TOOL_CALL`; it sets the answer when the example names one, sets or clears the tool call on every warm Agent it takes, and waits until the Agent reports them. What a test makes beyond the warm Agents, connections and agents alike, is deleted when it ends, so a machine it booted does not hold its runner's memory. A test owns its World, its Driver, which the project's `surface` option picks, and one browser page per persona, which Playwright traces and a sign-in step replaces with a fresh one; a scenario tagged `@wip` is expected to fail until the behaviour it states exists; when it fails, a screenshot of each page, the World's evidence and the state of every Agent it named are attached to it.
 */
export const test = base.extend<
  {
    surface: Surface;
    world: World;
    setup: Setup;
    pages: Pages;
    wip: void;
    driver: Driver;
    person: (persona: Persona) => Promise<Person>;
  },
  { cast: Cast }
>({
  surface: ["api", { option: true }],

  cast: [
    async ({ browser }, use, workerInfo) => {
      const slot = workerInfo.parallelIndex;
      const people = new Map<Persona, Promise<Person>>();
      const states = new Map<Persona, Promise<string>>();
      const warm = new Map<Persona, string[]>();
      const knowledgeBases = new Map<Persona, Promise<string>>();
      mkdirSync(".auth", { recursive: true });
      const person = (persona: Persona) => {
        if (!people.has(persona))
          people.set(persona, preparePerson(persona, slot));
        return people.get(persona)!;
      };
      await use({
        person,
        storageState: (persona) => {
          if (!states.has(persona))
            states.set(
              persona,
              person(persona).then((p) =>
                signIn(browser, p, `.auth/${p.account.username}.json`),
              ),
            );
          return states.get(persona)!;
        },
        forgetWarm: (persona, id) => {
          const agents = warm.get(persona) ?? [];
          const index = agents.indexOf(id);
          if (index >= 0) delete agents[index];
        },
        warmKnowledgeBase: async (persona) => {
          if (!knowledgeBases.has(persona))
            knowledgeBases.set(
              persona,
              warmKnowledgeBase(await person(persona)),
            );
          return knowledgeBases.get(persona)!;
        },
        warmAgent: async (persona, index) => {
          const agents = warm.get(persona) ?? [];
          warm.set(persona, agents);
          if (agents[index] === undefined)
            agents[index] = await warmMockAgent(await person(persona), index);
          return agents[index];
        },
      });
    },
    { scope: "worker", timeout: 600_000 },
  ],

  person: async ({ cast }, use) =>
    use((persona) => {
      if (!personas.includes(persona))
        throw new Error(
          `"${persona}" is no persona of the examples: use one of ${personas.join(", ")}`,
        );
      return cast.person(persona);
    }),

  world: async ({ cast }, use, testInfo) => {
    const world = new World();
    await use(world);
    for (const close of world.closers) close();
    if (testInfo.status === testInfo.expectedStatus) return;
    const agents = [];
    for (const record of world.agents.values()) {
      const owner = await cast.person(record.owner);
      agents.push(
        await owner.api.agents.get
          .query({ id: record.id })
          .catch((error: unknown) => ({ record, error: String(error) })),
      );
    }
    await testInfo.attach("evidence.json", {
      contentType: "application/json",
      body: JSON.stringify(
        { run: world.run, evidence: world.evidence, agents },
        null,
        2,
      ),
    });
  },

  setup: async ({ cast, world }, use) => {
    const allocated = new Map<Persona, number>();
    await use({
      connection: async (persona, name, kind) => {
        const owner = await cast.person(persona);
        const unique = world.unique(name);
        const input =
          "host" in kind
            ? customHeader(world, name, kind.host, kind)
            : undefined;
        const made =
          input !== undefined
            ? await owner.api.connections.create.mutate(input)
            : await owner.api.connections.create.mutate({
                templateId: "openai",
                name: unique,
                authKind: "header",
                value: "sk-acceptance-second-key",
              });
        world.connections.set(name, {
          owner: persona,
          name: unique,
          id: made.id,
          host: input?.host,
          secret:
            "key" in kind && kind.key !== undefined ? input?.value : undefined,
          envName: input?.envName,
        });
        world.made.push({ kind: "connection", owner: persona, id: made.id });
        world.note({
          step: "connection made",
          persona,
          name: unique,
          id: made.id,
        });
      },
      grant: async (persona, connection, agent) => {
        const owner = await cast.person(persona);
        const agentId = world.agent(agent).id;
        const connectionId = world.connection(connection).id;
        // UNIT_BOUNDARY_DESCRIPTION: a warm agent may still hold a connection an earlier example made, while its removal reaches the agent; one to the same host is let go first, so the grant meets only what this example made.
        const grantedHost = world.connection(connection).host;
        const owned = await owner.api.connections.list.query();
        const ours = new Set([...world.connections.values()].map((c) => c.id));
        const stale = (
          await owner.api.connections.getAgentConnections.query({ agentId })
        ).connections
          .map((c) => owned.find((o) => o.id === c.connectionId))
          .filter(
            (c) =>
              c !== undefined &&
              !ours.has(c.id) &&
              c.templateId === "custom-header" &&
              grantedHost !== undefined &&
              JSON.stringify(c).includes(grantedHost),
          )
          .map((c) => c!.id);
        await owner.api.connections.updateAgentConnections.mutate({
          agentId,
          grant: [connectionId],
          revoke: stale,
        });
        await expect
          .poll(
            async () =>
              (
                await owner.api.connections.getAgentConnections.query({
                  agentId,
                })
              ).connections.map((c) => c.connectionId),
            { timeout: 30_000, message: `${agent} never held ${connection}` },
          )
          .toContain(connectionId);
        const { host, secret, envName } = world.connection(connection);
        if (host === undefined || secret === undefined || envName === undefined)
          return;
        const placeholder = connectionEgressPlaceholder(connectionId);
        await expect
          .poll(
            async () =>
              (
                await owner.api.e2e.performFetch
                  .mutate({
                    agentId,
                    url: `https://${host}/headers`,
                    headers: { "x-api-key": placeholder },
                  })
                  .catch(() => ({ body: "" }))
              ).body,
            {
              timeout: 180_000,
              intervals: [3_000],
              message: `${agent}'s gateway never put ${connection}'s secret on a request to ${host}`,
            },
          )
          .toContain(secret);
        await expect
          .poll(
            async () => {
              const turn = await promptWhenSettled(
                agentId,
                await owner.token(),
                `__ENV__ ${envName}`,
              ).catch(() => undefined);
              if (turn === undefined) return "";
              world.made.push({
                kind: "session",
                owner: persona,
                id: turn.sessionId,
                agentId,
              });
              return turn.reply.trim();
            },
            {
              timeout: 120_000,
              intervals: [3_000],
              message: `${agent} never ran with ${connection}'s placeholder in ${envName}`,
            },
          )
          .toBe(`[env ${envName}] ${placeholder}`);
      },
      allowAll: async (persona, host, agent) => {
        const owner = await cast.person(persona);
        const rule = await owner.api.egressRules.create.mutate({
          agentId: world.agent(agent).id,
          host,
          verdict: "allow",
        });
        world.undo.push(() =>
          owner.api.egressRules.revoke.mutate({ id: rule.id }),
        );
        const agentId = world.agent(agent).id;
        await expect
          .poll(
            async () =>
              (
                await owner.api.e2e.performFetch
                  .mutate({
                    agentId,
                    url: `https://${host}/status/204`,
                    timeoutMs: 15_000,
                  })
                  .catch(() => ({ status: 0 }))
              ).status,
            {
              timeout: 120_000,
              intervals: [3_000],
              message: `${agent}'s rule for all of ${host} never took effect`,
            },
          )
          .not.toBe(0);
        world.note({ step: "egress allowed", host, agent, rule: rule.id });
      },
      agent: async (persona, name) => {
        const owner = await cast.person(persona);
        const made = await owner.api.agents.create.mutate({
          name: world.unique(name),
          templateId: mockTemplateId,
        });
        world.agents.set(name, {
          owner: persona,
          name: made.name,
          id: made.id,
        });
        world.made.push({ kind: "agent", owner: persona, id: made.id });
        world.note({
          step: "agent made",
          persona,
          name: made.name,
          id: made.id,
        });
      },
      session: async (persona, agent, text) => {
        const owner = await cast.person(persona);
        const turn = await promptOnce(
          world.agent(agent).id,
          await owner.token(),
          world.unique(text),
        );
        world.opened(persona, agent, text, turn.sessionId);
      },
      knowledgeBase: async (persona, name, folder) => {
        if (folder !== "wiki")
          throw new Error(
            `the warm knowledge base shares "wiki", not "${folder}"`,
          );
        const owner = await cast.person(persona);
        const id = await cast.warmKnowledgeBase(persona);
        if ((await owner.api.agents.get.query({ id })).state !== "running")
          await owner.api.agents.wake.mutate({ id }).catch(() => {});
        await expect
          .poll(async () => (await owner.api.agents.get.query({ id })).state, {
            timeout: 240_000,
            intervals: [1_000, 2_000],
            message: `${persona}'s knowledge base did not come up`,
          })
          .toBe("running");
        const { name: shown } = await owner.api.agents.get.query({ id });
        world.agents.set(name, { owner: persona, name: shown, id });
        world.undo.push(async () => {
          await owner.api.kbShares.revoke
            .mutate({ agentId: id })
            .catch(() => {});
          for (const dir of ["work/wiki", "work/notes"])
            await agentFiles(owner, id, "remove", { path: dir }).catch(() => 0);
        });
      },
      freshBrowser: async (agent) => {
        const record = world.agent(agent);
        const owner = await cast.person(record.owner);
        const cleared = await browserControl(owner, record.id, "clearData");
        expect(cleared.code, cleared.message).toBeUndefined();
      },
      browserTabs: async (agent, titles, front) => {
        const record = world.agent(agent);
        const owner = await cast.person(record.owner);
        await browserControl(owner, record.id, "clearData");
        const watch = await watchBrowser(owner, record.id);
        world.closers.push(watch.close);
        await expect
          .poll(() => watch.latest()?.state, {
            timeout: 120_000,
            message: `the browser of ${agent} never came up`,
          })
          .toBe("ready");
        const title = (t: string) =>
          `agent-browser eval 'document.title="${world.unique(t)}"'`;
        const script = titles
          .map((t, i) =>
            i === 0
              ? title(t)
              : `agent-browser tab new about:blank && ${title(t)}`,
          )
          .join(" && ");
        const env =
          (await owner.api.agents.get.query({ id: record.id })).env ?? [];
        const previous =
          env.find((v) => v.name === mockShellEnv)?.value ?? null;
        const shellIs = async (value: string | null) => {
          const now =
            (await owner.api.agents.get.query({ id: record.id })).env ?? [];
          await owner.api.agents.setEnv.mutate({
            id: record.id,
            env: [
              ...now.filter((v) => v.name !== mockShellEnv),
              ...(value === null ? [] : [{ name: mockShellEnv, value }]),
            ],
          });
          await expect
            .poll(
              async () =>
                (
                  await owner.api.e2e.getEnv
                    .query({ agentId: record.id, name: mockShellEnv })
                    .catch(() => undefined)
                )?.value ?? null,
              { timeout: 120_000, intervals: [250, 500, 1_000] },
            )
            .toBe(value);
          const expected =
            value === null
              ? `[env ${mockShellEnv} unset]`
              : `[env ${mockShellEnv}] ${value}`;
          await expect
            .poll(
              async () => {
                const turn = await promptWhenSettled(
                  record.id,
                  await owner.token(),
                  `__ENV__ ${mockShellEnv}`,
                ).catch(() => undefined);
                if (turn === undefined) return "";
                world.opened(
                  record.owner,
                  agent,
                  `__ENV__ ${mockShellEnv}`,
                  turn.sessionId,
                );
                return turn.reply.trim();
              },
              { timeout: 120_000, intervals: [2_000] },
            )
            .toBe(expected);
        };
        await shellIs(script);
        const turn = await promptWhenSettled(
          record.id,
          await owner.token(),
          world.unique("open the tabs"),
        );
        world.opened(record.owner, agent, "open the tabs", turn.sessionId);
        await shellIs(previous);
        let frontId = "";
        await expect
          .poll(
            () => {
              const tabs = watch.latest()?.tabs ?? [];
              frontId =
                tabs.find((t) => t.title === world.unique(front))?.id ?? "";
              return titles.every((t) =>
                tabs.some((tab) => tab.title === world.unique(t)),
              );
            },
            {
              timeout: 60_000,
              message: `the browser of ${agent} never showed its tabs`,
            },
          )
          .toBe(true);
        await browserControl(owner, record.id, "selectTab", { tab: frontId });
      },
      closedTab: async (agent, title) => {
        const record = world.agent(agent);
        const owner = await cast.person(record.owner);
        const watch = await watchBrowser(owner, record.id);
        world.closers.push(watch.close);
        let id = "";
        await expect
          .poll(
            () => {
              id =
                watch
                  .latest()
                  ?.tabs.find((t) => t.title === world.unique(title))?.id ?? "";
              return id;
            },
            { timeout: 60_000 },
          )
          .not.toBe("");
        await browserControl(owner, record.id, "closeTab", { tab: id });
        world.browserTabs.set(`${agent}/${title}`, id);
      },
      sleep: async (name) => {
        const agent = world.agent(name);
        const owner = await cast.person(agent.owner);
        await owner.api.agents.sleep.mutate({ id: agent.id });
        await expect
          .poll(
            async () =>
              (await owner.api.agents.get.query({ id: agent.id })).state,
            {
              timeout: 120_000,
              intervals: [1_000, 2_000],
              message: `${agent.name} did not fall asleep`,
            },
          )
          .toBe("hibernated");
        world.note({ step: "agent asleep", name: agent.name });
        world.undo.push(async () => {
          await owner.api.agents.wake.mutate({ id: agent.id }).catch(() => {});
          const up = await expect
            .poll(
              async () =>
                (await owner.api.agents.get.query({ id: agent.id })).state,
              { timeout: 240_000, intervals: [2_000] },
            )
            .toBe("running")
            .then(
              () => true,
              () => false,
            );
          const { description } = await owner.api.agents.get.query({
            id: agent.id,
          });
          if (up || description?.endsWith(" kb")) return;
          // UNIT_BOUNDARY_DESCRIPTION: a warm agent that does not come back from its sleep is retired, so the examples after this one get a new one instead of waiting on it; this example's own steps have already failed if the wake mattered to it.
          await owner.api.agents.update.mutate({
            id: agent.id,
            description: "retired",
          });
          await owner.api.agents.delete
            .mutate({ id: agent.id })
            .catch(() => {});
          cast.forgetWarm(agent.owner, agent.id);
        });
      },
      rule: async (persona, agent, { method, host, pathPattern }, verdict) => {
        const owner = await cast.person(persona);
        const agentId = world.agent(agent).id;
        const made = await owner.api.egressRules.create.mutate({
          agentId,
          host,
          method,
          pathPattern,
          verdict,
        });
        world.undo.push(() =>
          owner.api.egressRules.revoke.mutate({ id: made.id }),
        );
        const covered = `https://${host}${pathPattern === "*" ? "/status/204" : pathPattern.replace("*", "204")}`;
        await expect
          .poll(
            async () =>
              (
                await owner.api.e2e.performFetch
                  .mutate({ agentId, url: covered, timeoutMs: 5_000 })
                  .catch(() => ({ status: 0 }))
              ).status,
            {
              timeout: 180_000,
              intervals: [3_000],
              message: `${agent}'s rule for ${host}${pathPattern} never took effect`,
            },
          )
          .toBe(
            verdict === "deny"
              ? 403
              : covered.includes("/status/204")
                ? 204
                : 200,
          );
        for (const a of await waitingApprovals(owner, agentId))
          await owner.api.approvals.dismiss.mutate({ id: a.id });
      },
      hold: async (agent, url, times) => {
        const record = world.agent(agent);
        const owner = await cast.person(record.owner);
        for (const a of await waitingApprovals(owner, record.id))
          await owner.api.approvals.dismiss.mutate({ id: a.id });
        const request = requestOf(`GET ${url}`);
        const results: Promise<number>[] = [];
        for (let i = 0; i < times; i++) {
          results.push(
            owner.api.e2e.performFetch
              .mutate({
                agentId: record.id,
                url,
                timeoutMs: E2E_PERFORM_FETCH_MAX_TIMEOUT_MS,
              })
              .then(
                (r) => r.status,
                () => 0,
              ),
          );
          let approvalId = "";
          await expect
            .poll(
              async () => {
                const waiting = await waitingApprovals(
                  owner,
                  record.id,
                  request,
                );
                approvalId = waiting[0]?.id ?? "";
                return waiting.length;
              },
              {
                timeout: 20_000,
                message: `${agent}'s request to ${url} was not held`,
              },
            )
            .toBe(1);
          world.held.set(agent, { approvalId, url, results });
        }
        // UNIT_BOUNDARY_DESCRIPTION: a request that joins a waiting approval files nothing of its own, so the time it takes to reach the gateway is waited out rather than seen.
        if (times > 1)
          await new Promise((resolve) => setTimeout(resolve, 5_000));
        world.undo.push(async () => {
          for (const a of await waitingApprovals(owner, record.id))
            await owner.api.approvals.dismiss.mutate({ id: a.id });
        });
      },
      flag: async (persona, feature) => {
        const owner = await cast.person(persona);
        await owner.api.features.setFlag.mutate({ feature, enabled: true });
        world.undo.push(() =>
          owner.api.features.setFlag.mutate({ feature, enabled: false }),
        );
      },
      runningAgent: async (
        persona,
        name,
        { answer, publishes, calls, shell, requiresNaming } = {},
      ) => {
        const index = allocated.get(persona) ?? 0;
        allocated.set(persona, index + 1);
        const id = await cast.warmAgent(persona, index);
        const owner = await cast.person(persona);
        if ((await owner.api.agents.get.query({ id })).state !== "running") {
          await owner.api.agents.wake.mutate({ id });
          await expect
            .poll(
              async () => (await owner.api.agents.get.query({ id })).state,
              {
                timeout: 240_000,
                intervals: [1_000, 2_000],
                message: `${persona}'s warm agent did not wake`,
              },
            )
            .toBe("running");
        }
        const unique = world.unique(name);
        await owner.api.agents.update.mutate({ id, name: unique });
        const wanted = new Map<string, string | null>([
          ...(answer === undefined
            ? []
            : [[mockReplyEnv, world.unique(answer)] as [string, string]]),
          [
            mockToolEnv,
            publishes === undefined
              ? calls === undefined
                ? null
                : JSON.stringify(calls)
              : JSON.stringify({
                  name: "create_artifact",
                  arguments: {
                    title: world.unique(publishes),
                    content: `<h1>${world.unique(publishes)}</h1>`,
                    file_name: "artifact.html",
                    icon: "📄",
                  },
                }),
          ],
        ]);
        wanted.set(mockShellEnv, shell ?? null);
        const env = (await owner.api.agents.get.query({ id })).env ?? [];
        await owner.api.agents.setEnv.mutate({
          id,
          env: [
            ...env.filter((v) => !wanted.has(v.name)),
            ...[...wanted]
              .filter(([, value]) => value !== null)
              .map(([envName, value]) => ({ name: envName, value: value! })),
          ],
        });
        for (const [envName, value] of wanted)
          await expect
            .poll(
              async () =>
                (
                  await owner.api.e2e.getEnv
                    .query({ agentId: id, name: envName })
                    .catch(() => undefined)
                )?.value ?? null,
              {
                timeout: 120_000,
                intervals: [250, 500, 1_000],
                message: `${persona}'s agent never took ${envName}`,
              },
            )
            .toBe(value);
        for (const [envName, value] of wanted) {
          const expected =
            value === null
              ? `[env ${envName} unset]`
              : `[env ${envName}] ${value}`;
          await expect
            .poll(
              async () => {
                const turn = await promptWhenSettled(
                  id,
                  await owner.token(),
                  `__ENV__ ${envName}`,
                ).catch(() => undefined);
                if (turn === undefined) return "";
                world.made.push({
                  kind: "session",
                  owner: persona,
                  id: turn.sessionId,
                  agentId: id,
                });
                return turn.reply.trim();
              },
              {
                timeout: 120_000,
                intervals: [2_000],
                message: `${persona}'s agent never ran with ${envName}`,
              },
            )
            .toBe(expected);
        }
        world.agents.set(name, { owner: persona, name: unique, id });
        world.undo.unshift(async () => {
          for (const a of await waitingApprovals(owner, id))
            await owner.api.approvals.dismiss.mutate({ id: a.id });
        });
        if (requiresNaming !== undefined) {
          await owner.api.agents.setCredentialInjection.mutate({
            id,
            requireConnectionAddress: requiresNaming,
          });
          world.undo.push(() =>
            owner.api.agents.setCredentialInjection.mutate({
              id,
              requireConnectionAddress: true,
            }),
          );
        }
        world.note({ step: "agent ready", persona, name: unique, id });
      },
    });
    for (const undo of world.undo.reverse()) await undo().catch(() => {});
    for (const item of world.made.reverse()) {
      const owner = await cast.person(item.owner);
      if (item.kind === "agent")
        await owner.api.agents.delete.mutate({ id: item.id }).catch(() => {});
      else if (item.kind === "session")
        await acpRequest(
          item.agentId!,
          await owner.token(),
          "platform/deleteSession",
          { sessionId: item.id },
        ).catch(() => {});
      else
        await owner.api.connections.delete
          .mutate({ id: item.id })
          .catch(() => {});
    }
  },

  pages: async ({ browser, cast }, use, testInfo) => {
    const open = new Map<Persona, Page>();
    const pageIn = async (person: Person, storageState?: string) => {
      const page = await (await browser.newContext({ storageState })).newPage();
      await open.get(person.persona)?.context().close();
      open.set(person.persona, page);
      return page;
    };
    await use({
      of: async (person) =>
        open.get(person.persona) ??
        pageIn(person, await cast.storageState(person.persona)),
      fresh: (person) => pageIn(person),
    });
    const failed = testInfo.status !== testInfo.expectedStatus;
    for (const [persona, page] of open) {
      if (failed)
        await testInfo.attach(`${persona}-screenshot.png`, {
          body: await page.screenshot({ fullPage: true }),
          contentType: "image/png",
        });
      await page.context().close();
    }
  },

  wip: [
    async ({}, use, testInfo) => {
      testInfo.fail(
        testInfo.tags.includes("@wip"),
        "@wip: expected to fail until the behaviour it states exists",
      );
      await use();
    },
    { auto: true },
  ],

  driver: async ({ surface, world, pages }, use) => {
    if (surface === "cli")
      throw new Error(
        "no CLI driver yet: tag no scenario @cli before it exists",
      );
    await use(
      surface === "ui" ? uiDriver(world, pages) : apiDriver(world, pages),
    );
  },
});
