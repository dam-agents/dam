// TEST_OVERVIEW: "Reset user onboarding" starts one person's onboarding over and
// TEST_OVERVIEW: nobody else's: it forgets that their assistant was ever used,
// TEST_OVERVIEW: starts the Get started checklist over, records its first Agent
// TEST_OVERVIEW: again so the person meets a first-timer's checklist, and makes a
// TEST_OVERVIEW: new assistant when the one on record was deleted. It is refused
// TEST_OVERVIEW: while the feature is off for them.
import type { Agent } from "api-server-api";
import { describe, expect, it, vi } from "vitest";

import type { InfraAgent } from "../../modules/agents/infrastructure/agent-mappers.js";
import type {
  AssistantRow,
  AssistantsRepository,
} from "../../modules/assistants/infrastructure/assistants-repository.js";
import { createAssistantsService } from "../../modules/assistants/services/assistants-service.js";

const NAME = "Dambledore";

/** UNIT_BOUNDARY_DESCRIPTION: the row store as PostgreSQL behaves — one row per owner, and `replaceAgent` a compare-and-set on the Agent id. */
function rowStore(rows: readonly AssistantRow[]) {
  const byOwner = new Map(rows.map((row) => [row.owner, row]));
  const repo: AssistantsRepository = {
    find: async (owner) => byOwner.get(owner) ?? null,
    claim: async (owner, agentId) => {
      if (byOwner.has(owner)) return false;
      byOwner.set(owner, { owner, agentId, used: false });
      return true;
    },
    release: async (owner, agentId) => {
      if (byOwner.get(owner)?.agentId === agentId) byOwner.delete(owner);
    },
    replaceAgent: async (owner, fromAgentId, toAgentId) => {
      const row = byOwner.get(owner);
      if (!row || row.agentId !== fromAgentId) return false;
      byOwner.set(owner, { ...row, agentId: toAgentId, used: false });
      return true;
    },
    markUsed: async (agentId) => {
      for (const [owner, row] of byOwner)
        if (row.agentId === agentId) byOwner.set(owner, { ...row, used: true });
    },
    resetUsed: async (owner) => {
      const row = byOwner.get(owner);
      if (row) byOwner.set(owner, { ...row, used: false });
    },
  };
  return { byOwner, repo };
}

/** UNIT_BOUNDARY_DESCRIPTION: the Agents an owner still has; a deleted one is simply absent, which is what the reset finds. */
function agentStore(owner: string, existing: readonly string[]) {
  const live = new Map<string, InfraAgent>(
    existing.map((id) => [
      id,
      {
        id,
        name: NAME,
        owner,
        spec: { avatar: undefined },
      } as unknown as InfraAgent,
    ]),
  );
  const create = vi.fn(async (input: { id?: string; name: string }) => {
    live.set(input.id!, {
      id: input.id,
      name: input.name,
      owner,
      spec: { avatar: undefined },
    } as unknown as InfraAgent);
    return live.get(input.id!) as unknown as Agent;
  });
  return {
    live,
    create,
    list: async () =>
      [...live.values()].map((agent) => agent as unknown as Agent),
  };
}

function service(deps: {
  owner: string;
  rows: ReturnType<typeof rowStore>;
  agents: ReturnType<typeof agentStore>;
  enabled?: boolean;
}) {
  const resetChecklist = vi.fn(async () => undefined);
  const provisioned = vi.fn(async () => {});
  const { assistants, ensure } = createAssistantsService({
    repo: deps.rows.repo,
    owner: deps.owner,
    assistantName: NAME,
    brandName: "DAM",
    enabled: async () => deps.enabled ?? true,
    agentOf: async (agentId) => deps.agents.live.get(agentId) ?? null,
    agents: { list: deps.agents.list, create: deps.agents.create },
    enrolled: async () => {},
    provisioned,
    resetChecklist,
  });
  return { resetChecklist, provisioned, assistants, ensure };
}

describe("resetting a person's onboarding", () => {
  // TEST_SCENARIO: the person has an assistant they have used; the reset forgets that, starts the checklist over and records its first Agent again, so they meet a first-timer's checklist — nothing is deleted.
  it("forgets the use and starts the checklist over", async () => {
    const rows = rowStore([{ owner: "alice", agentId: "agent-a", used: true }]);
    const agents = agentStore("alice", ["agent-a"]);
    const w = service({ owner: "alice", rows, agents });
    await w.assistants.resetOnboarding();
    expect(await w.assistants.state()).toEqual({
      agentId: "agent-a",
      used: false,
    });
    expect(w.resetChecklist).toHaveBeenCalledTimes(1);
    expect(w.provisioned).toHaveBeenCalledTimes(1);
    expect(agents.create).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: the person deleted their assistant, so the reset makes a new ordinary Agent and points the record at it, unused: the next landing greets them in its chat.
  it("creates the assistant again when it was deleted", async () => {
    const rows = rowStore([
      { owner: "alice", agentId: "agent-gone", used: true },
    ]);
    const agents = agentStore("alice", []);
    const w = service({ owner: "alice", rows, agents });
    await w.assistants.resetOnboarding();
    expect(agents.create).toHaveBeenCalledTimes(1);
    const state = await w.assistants.state();
    expect(state?.used).toBe(false);
    expect(state?.agentId).not.toBe("agent-gone");
    expect(agents.live.has(state!.agentId)).toBe(true);
  });

  // TEST_SCENARIO: two people reset at once; each reset touches only its caller's record, and the other person's assistant keeps the use it had.
  it("resets only the caller's assistant", async () => {
    const rows = rowStore([
      { owner: "alice", agentId: "agent-a", used: true },
      { owner: "bob", agentId: "agent-b", used: true },
    ]);
    const alice = service({
      owner: "alice",
      rows,
      agents: agentStore("alice", ["agent-a"]),
    });
    await alice.assistants.resetOnboarding();
    expect(rows.byOwner.get("alice")).toMatchObject({ used: false });
    expect(rows.byOwner.get("bob")).toMatchObject({ used: true });
  });

  // TEST_SCENARIO: the feature is off for the caller — the install pins it off, or they turned it off — so the reset is refused rather than quietly recreating anything.
  it("is refused while the feature is off for the caller", async () => {
    const rows = rowStore([{ owner: "alice", agentId: "agent-a", used: true }]);
    const w = service({
      owner: "alice",
      rows,
      agents: agentStore("alice", ["agent-a"]),
      enabled: false,
    });
    await expect(w.assistants.resetOnboarding()).rejects.toThrow(
      "does not offer the assistant",
    );
    expect(rows.byOwner.get("alice")).toMatchObject({ used: true });
    expect(w.resetChecklist).not.toHaveBeenCalled();
  });
});
