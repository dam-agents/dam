// TEST_OVERVIEW: the mark a removed feature left behind. Clearing it touches only the marks: the stop request goes only while it still carries the stamp the disable wrote, and an activity stamp or a pin written since is left alone, so a wake, a sleep or a schedule poke that landed in between is never undone. A second clear, a conflicting write or an agent that is gone changes nothing.
import { describe, expect, it } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Db } from "db";
import { createControlAgentsRepository } from "../../modules/agent-store/agents-repository.js";
import { createAgentsRepository } from "../../modules/agents/infrastructure/agents-repository.js";
import { createLiveAgentStateCache } from "../../modules/agents/infrastructure/agent-state-cache.js";
import type { KubeObject } from "../../modules/agents/infrastructure/k8s.js";
import { fakeK8s } from "../helpers/fake-k8s.js";

const STOP = "agent-platform.ai/stop-requested";
const DISABLED = "agent-platform.ai/disabled";
const ACTIVITY = "agent-platform.ai/last-activity";
const SESSION = "agent-platform.ai/active-session";
const STAMP = "2026-10-15T10:00:00Z";
const LATER = "2026-10-15T11:00:00Z";

function setup(annotations: Record<string, string>) {
  const { client, store } = fakeK8s([
    {
      metadata: { name: "a1", annotations },
      spec: { name: "a1" },
      status: {
        conditions: [{ type: "Ready", status: "False", reason: "Hibernated" }],
      },
    } as KubeObject,
  ]);
  const repo = createAgentsRepository(
    client,
    createLiveAgentStateCache(client),
  );
  const seen = () => store.get("a1")?.metadata?.annotations ?? {};
  return { repo, seen, store, client };
}

describe("clearLegacyDisabled", () => {
  // TEST_SCENARIO: a disable wrote the mark and the stop request with one stamp, so clearing removes both and the agent is an ordinary idle one; the activity stamp it did not write stays.
  it("clears the mark and the stop request it stamped, and nothing else", async () => {
    const { repo, seen } = setup({
      [DISABLED]: STAMP,
      [STOP]: STAMP,
      [ACTIVITY]: LATER,
      [SESSION]: "true",
    });

    expect(await repo.clearLegacyDisabled("a1")).toBe(true);
    expect(seen()[DISABLED]).toBe("");
    expect(seen()[STOP]).toBe("");
    expect(seen()[ACTIVITY]).toBe(LATER);
    expect(seen()[SESSION]).toBe("true");
  });

  // TEST_SCENARIO: a newer stop request is a stop the owner asked for after the disable; the cleanup must not undo it, so the agent stays down.
  it("keeps a stop request stamped after the mark", async () => {
    const { repo, seen } = setup({ [DISABLED]: STAMP, [STOP]: LATER });

    expect(await repo.clearLegacyDisabled("a1")).toBe(true);
    expect(seen()[DISABLED]).toBe("");
    expect(seen()[STOP]).toBe(LATER);
  });

  // TEST_SCENARIO: two replicas booting both find the mark; the first clears it and the second writes nothing.
  it("is a no-op once the mark is gone", async () => {
    const { repo, seen } = setup({ [DISABLED]: STAMP, [STOP]: STAMP });

    expect(await repo.clearLegacyDisabled("a1")).toBe(true);
    expect(await repo.clearLegacyDisabled("a1")).toBe(false);
    expect(seen()[DISABLED]).toBe("");
  });

  // TEST_SCENARIO: an agent that never carried the mark is untouched.
  it("answers false for an agent that is not marked", async () => {
    const { repo, seen } = setup({ [STOP]: LATER });

    expect(await repo.clearLegacyDisabled("a1")).toBe(false);
    expect(seen()[STOP]).toBe(LATER);
  });

  // TEST_SCENARIO: the write names the version it was decided from, so a conflicting clear re-reads and finds the mark the other one removed rather than overwriting what changed with it.
  it("re-reads a conflicting write instead of going through", async () => {
    const { repo, seen, store, client } = setup({
      [DISABLED]: STAMP,
      [STOP]: STAMP,
    });
    const patch = client.patchCustomObject.bind(client);
    let conflicts = 1;
    client.patchCustomObject = async (...args) => {
      if (conflicts-- > 0) {
        store.get("a1")!.metadata!.annotations![DISABLED] = "";
        throw Object.assign(new Error("409 conflict"), { code: 409 });
      }
      return patch(...args);
    };

    expect(await repo.clearLegacyDisabled("a1")).toBe(false);
    expect(seen()[DISABLED]).toBe("");
  });
});

function fakeDb(changed: boolean) {
  const seen: { values?: Record<string, SQL | null | Date>; where?: SQL } = {};
  const db = {
    update: () => ({
      set: (values: Record<string, SQL | null | Date>) => {
        seen.values = values;
        return {
          where: (cond: SQL) => {
            seen.where = cond;
            return {
              returning: async () =>
                changed ? [{ agentId: "a1" }] : ([] as unknown[]),
            };
          },
        };
      },
    }),
  } as unknown as Db;
  return { db, seen };
}

const render = (value: unknown) => new PgDialect().sqlToQuery(value as SQL);

describe("clearLegacyDisabled over the control rows", () => {
  // TEST_SCENARIO: one statement clears the mark and the stop request only while the stop still carries the disable's own instant, so a newer stop survives; the statement's predicate is the mark itself.
  it("clears the mark and a stop request stamped with it, in one guarded statement", async () => {
    const { db, seen } = fakeDb(true);
    const repo = createControlAgentsRepository(db, {} as never);

    expect(await repo.clearLegacyDisabled("a1")).toBe(true);
    const values = seen.values ?? {};
    expect(values.disabledAt).toBeNull();
    const stop = render(values.stopRequestedAt);
    expect(stop.sql).toMatch(
      /case when .*"stop_requested_at" = .*"disabled_at" then null else .*"stop_requested_at" end/i,
    );
    expect(render(values.stopRequestToken).sql).toMatch(
      /else .*"stop_request_token" end/i,
    );
    expect(render(seen.where).sql).toMatch(/"disabled_at" is not null/i);
  });

  // TEST_SCENARIO: only the marks are in the write, so the pins and the activity stamp a wake, a sleep or a schedule poke wrote are left as they are.
  it("writes nothing but the marks", async () => {
    const { db, seen } = fakeDb(true);
    const repo = createControlAgentsRepository(db, {} as never);

    await repo.clearLegacyDisabled("a1");
    expect(Object.keys(seen.values ?? {}).sort()).toEqual([
      "disabledAt",
      "stopRequestToken",
      "stopRequestedAt",
      "updatedAt",
    ]);
  });

  // TEST_SCENARIO: a row whose mark another replica already cleared matches no row, so the second clear reports that it changed nothing.
  it("reports no change when no marked row matches", async () => {
    const { db } = fakeDb(false);
    const repo = createControlAgentsRepository(db, {} as never);

    expect(await repo.clearLegacyDisabled("a1")).toBe(false);
  });
});
