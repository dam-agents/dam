import { describe, it, expect, vi } from "vitest";
import type { LocalSkill, SkillRef } from "api-server-api";
import { createSkillsService } from "../../modules/skills/services/skills-service.js";
import type { SkillsServiceDeps } from "../../modules/skills/services/skills-service.js";
import {
  AgentRuntimeUnreachableError,
  AgentRuntimeUpstreamError,
} from "../../modules/skills/infrastructure/agent-runtime-client.js";

const AGENT = "agent-1";
const OWNER = "owner-1";

const TRACKED: SkillRef[] = [
  { source: "https://github.com/acme/skills", name: "deploy", version: "abc" },
];

/** Minimal running InfraAgent — computeAgentState reads only error/ready/
 *  hibernated, so the rest is irrelevant here. */
function runningInfra() {
  return { id: AGENT, name: AGENT, spec: {}, ready: true, hibernated: false };
}

function makeDeps(listLocal: () => Promise<LocalSkill[]>) {
  const reconcile = vi.fn(async () => {});
  const agentsRepo = {
    async get(id: string) {
      return id === AGENT ? runningInfra() : null;
    },
  };
  const agentSkillsRepo = {
    async listSkills() {
      return TRACKED;
    },
    async listPublishes() {
      return [];
    },
    reconcile,
  };
  const runtimeClient = { listLocal };
  const deps = {
    agentsRepo,
    agentSkillsRepo,
    runtimeClient,
    owner: OWNER,
  } as unknown as SkillsServiceDeps;
  return { service: createSkillsService(deps), reconcile };
}

describe("skills getState — unreachable running pod", () => {
  it("falls back to tracked refs (no reconcile) when the pod is unreachable", async () => {
    const { service, reconcile } = makeDeps(() => {
      throw new AgentRuntimeUnreachableError("listLocal: connect ECONNREFUSED");
    });

    const state = await service.getState(AGENT);

    expect(state).toEqual({
      installed: TRACKED,
      standalone: [],
      instancePublishes: [],
    });
    // Must not evict rows when we can't see the disk.
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("still throws on a non-unreachable error (no over-catching)", async () => {
    const { service } = makeDeps(() => {
      throw new AgentRuntimeUpstreamError("listLocal: boom", { status: 500 });
    });

    await expect(service.getState(AGENT)).rejects.toBeInstanceOf(
      AgentRuntimeUpstreamError,
    );
  });
});

describe("skills listLocal — unreachable running pod", () => {
  it("returns an empty list when the pod is unreachable", async () => {
    const { service } = makeDeps(() => {
      throw new AgentRuntimeUnreachableError("listLocal: timeout");
    });

    await expect(service.listLocal(AGENT)).resolves.toEqual([]);
  });
});
