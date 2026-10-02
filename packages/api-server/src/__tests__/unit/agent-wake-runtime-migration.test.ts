// TEST_OVERVIEW: a user's wake for an Agent a runtime migration holds down is refused before anything is written, because waking would only clear the stop request the migration is meant to restore, and nothing can start the Agent until the move ends. A migration that holds nothing, or none at all, leaves the wake to go through.
import { describe, expect, it, vi } from "vitest";
import { createAgentsService } from "../../modules/agents/services/agents-service.js";
import {
  parseInfraAgent,
  type InfraAgent,
} from "../../modules/agents/infrastructure/agent-mappers.js";

type AgentsDeps = Parameters<typeof createAgentsService>[0];

function unused<T extends object>(fields: Partial<T> = {}): T {
  return new Proxy(fields, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected dependency: ${String(key)}`);
    },
  }) as T;
}

function setup(hold: InfraAgent["runtimeMigrationHold"]) {
  const agent: InfraAgent = {
    ...parseInfraAgent({
      metadata: {
        name: "agent-1",
        labels: { "agent-platform.ai/owner": "owner-1" },
      },
      spec: { image: "example.com/agent:latest" },
    }),
    runtimeMigrationHold: hold,
  };
  const wake = vi.fn(async () => null);
  const agents = createAgentsService({
    owner: "owner-1",
    repo: unused<AgentsDeps["repo"]>({
      isOwnedBy: async () => true,
      get: async () => agent,
      wake,
    }),
  } as Partial<AgentsDeps> as AgentsDeps);
  return { agents, wake };
}

describe("waking an agent during a runtime migration", () => {
  // TEST_SCENARIO: from the container's stop until the machine has booted from the copy, and after a failure that came after the stop, the wake is refused with whether the move failed, and the Agent's annotations are never patched.
  it.each([
    ["migrating", false],
    ["failed", true],
  ] as const)("is refused while the migration is %s", async (hold, failed) => {
    const { agents, wake } = setup(hold);
    expect(await agents.wake("agent-1")).toEqual({
      ok: false,
      error: { type: "RuntimeMigrating", failed },
    });
    expect(wake).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: with no migration, or one in its preflight where the container still runs, the wake reaches the repository as any wake does.
  it.each(["none", undefined] as const)(
    "goes through with hold %s",
    async (hold) => {
      const { agents, wake } = setup(hold);
      await agents.wake("agent-1");
      expect(wake).toHaveBeenCalledOnce();
    },
  );
});
