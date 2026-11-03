// TEST_OVERVIEW: the platform's Environments egress rule, as the owner meets it among an Agent's rules: removing it withdraws the Agent's key, it cannot be edited, and restoring it is the owner's own act, refused for an Agent they do not own.
import { describe, expect, it, vi } from "vitest";
import { PLATFORM_ENVIRONMENTS_SOURCE } from "api-server-api";
import { createEgressRulesService } from "../../modules/egress-rules/services/egress-rules-service.js";
import type { EgressRulesRepository } from "../../modules/egress-rules/infrastructure/egress-rules-repository.js";
import type { EgressRuleRow } from "../../modules/egress-rules/domain/types.js";

const platformRow: EgressRuleRow = {
  id: "r-platform",
  agentId: "agent-a",
  host: "*.env.example.com",
  method: "*",
  pathPattern: "*",
  verdict: "allow",
  decidedBy: "alice",
  decidedAt: new Date(0),
  status: "active",
  source: PLATFORM_ENVIRONMENTS_SOURCE,
};

function service(owned = true) {
  const rows = [{ ...platformRow }];
  const repo = {
    getById: async (id: string) => rows.find((r) => r.id === id) ?? null,
    revoke: async (id: string) => {
      for (const r of rows) if (r.id === id) r.status = "revoked";
    },
    listForAgent: async () => rows.filter((r) => r.status === "active"),
    updateTakeOwnership: vi.fn(async () => null),
  } as unknown as EgressRulesRepository;
  const platformAccess = {
    withdraw: vi.fn(async () => {}),
    restore: vi.fn(async () => ({ ...platformRow, id: "r-new" })),
    state: vi.fn(async () => ({ state: "removed" as const, host: platformRow.host })),
  };
  const svc = createEgressRulesService({
    repo,
    l7Hosts: { set: async () => {} },
    trustedHosts: [],
    isAgentOwnedBy: async () => owned,
    ownerSub: "alice",
    actor: "alice",
    resolveUserEmail: async () => null,
    platformAccess,
  });
  return { svc, rows, repo, platformAccess };
}

describe("the platform's Environments rule", () => {
  // TEST_SCENARIO: the owner removes the rule from the agent's egress rules. The rule is revoked like any other, and the agent's key goes with it, so its gateway stops sending it.
  it("withdraws the agent's key when the owner removes it", async () => {
    const { svc, rows, platformAccess } = service();
    await svc.revoke("r-platform");
    expect(rows[0]!.status).toBe("revoked");
    expect(platformAccess.withdraw).toHaveBeenCalledWith("agent-a");
  });

  // TEST_SCENARIO: the owner tries to narrow the rule to one path. It is refused: the key is sent for the whole domain, and a narrowed rule would no longer say what the gateway does.
  it("cannot be edited", async () => {
    const { svc, repo } = service();
    await expect(svc.update({ id: "r-platform", pathPattern: "/x" })).rejects.toThrow(
      /cannot be edited/,
    );
    expect(repo.updateTakeOwnership).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: the owner restores the rule they removed; another owner cannot restore it for an agent that is not theirs.
  it("is restored by its owner only", async () => {
    const mine = service();
    expect(await mine.svc.restorePlatformRule("agent-a")).toMatchObject({
      id: "r-new",
      source: PLATFORM_ENVIRONMENTS_SOURCE,
    });
    expect(await mine.svc.platformRule("agent-a")).toEqual({
      state: "removed",
      host: "*.env.example.com",
    });

    const theirs = service(false);
    await expect(theirs.svc.restorePlatformRule("agent-a")).rejects.toThrow(/agent not found/);
    expect(theirs.platformAccess.restore).not.toHaveBeenCalled();
    expect(await theirs.svc.platformRule("agent-a")).toEqual({ state: "unavailable" });
  });
});
