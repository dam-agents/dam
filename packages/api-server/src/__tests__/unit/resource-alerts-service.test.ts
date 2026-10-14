// TEST_OVERVIEW: The unattended resource alerts send a message only after winning the claim on the owner's alert mark, so two evaluations racing over one reading send once; an owner whose runner cannot be read is left alone; and a runner out-of-memory episode collects its affected agents into one message.
import { describe, expect, it, vi } from "vitest";

import type { InfraAgent } from "../../modules/agents/infrastructure/agent-mappers.js";
import type { AlertMark } from "../../modules/resource-alerts/domain/alert-policy.js";
import type { ResourceAlertsRepository } from "../../modules/resource-alerts/infrastructure/resource-alerts-repository.js";
import { createResourceAlertsService } from "../../modules/resource-alerts/services/resource-alerts-service.js";

const GIB = 1024 ** 3;

function memoryRepo(): ResourceAlertsRepository {
  const rows = new Map<string, { mark: AlertMark; version: number }>();
  return {
    async read(owner, kind) {
      const row = rows.get(`${owner}/${kind}`);
      return row
        ? { mark: row.mark, version: row.version }
        : {
            mark: { level: "ok", notifiedLevel: null, notifiedAt: null },
            version: null,
          };
    },
    async listOwners(kind, level) {
      return [...rows]
        .filter(([k, r]) => k.endsWith(`/${kind}`) && r.mark.level === level)
        .map(([k]) => k.split("/")[0]!);
    },
    async claim(owner, kind, seen, next) {
      const key = `${owner}/${kind}`;
      const current = rows.get(key)?.version ?? null;
      if (current !== seen) return false;
      rows.set(key, { mark: next, version: (seen ?? 0) + 1 });
      return true;
    },
  };
}

function agent(name: string, reason?: string): InfraAgent {
  return {
    id: name,
    name,
    owner: "kc|a",
    ...(reason ? { agentPodNotReadyReason: reason } : {}),
  } as InfraAgent;
}

function service(opts: {
  storage?: { usedBytes: number; usableBytes: number } | null;
  agents?: InfraAgent[];
}) {
  const notify = vi.fn(async (_ownerSub: string, _text: string) => ({
    sent: 1,
  }));
  const svc = createResourceAlertsService({
    repo: memoryRepo(),
    notify,
    listStorageOwners: async () => ["kc|a"],
    readStorage: async () => opts.storage ?? null,
    listOwnerAgents: async () => opts.agents ?? [],
    homeUrl: "http://ui",
    log: () => {},
    collectMs: 0,
  });
  return { svc, notify };
}

describe("resource alerts service", () => {
  // TEST_SCENARIO: Two evaluations of the same reading race, as a double tick or a lease handover would; only the one that wins the claim sends.
  it("sends a storage alert once when two evaluations race", async () => {
    const { svc, notify } = service({
      storage: { usedBytes: 92 * GIB, usableBytes: 100 * GIB },
    });
    await Promise.all([svc.evaluateStorage(), svc.evaluateStorage()]);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]![1]).toContain("used 92.0 of 100.0 GiB");
  });

  it("leaves an owner alone whose runner cannot be read", async () => {
    const { svc, notify } = service({ storage: null });
    await svc.evaluateStorage();
    expect(notify).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: A runner kill stamps every running agent of the owner; one message names them all rather than one per agent.
  it("names every affected agent in one out-of-memory message", async () => {
    const affected = [
      agent("scout", "RunnerOutOfMemory"),
      agent("builder", "RunnerOutOfMemory"),
    ];
    const { svc, notify } = service({ agents: affected });
    for (const a of affected) svc.agentChanged(a);
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    expect(notify.mock.calls[0]![1]).toContain(": scout, builder.");
  });
});
