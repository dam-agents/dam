// TEST_OVERVIEW: a user's wake for an Agent a runtime migration holds down is refused before anything is written, because waking would only clear the stop request the migration is meant to restore, and nothing can start the Agent until the move ends. A sleep or a stop in that time is refused too, since no wake could undo it until the move ends, and so is a disable or an enable, which would fight the migration over the same stop request. A stop is the owner's alone, and with no hold it reaches the repository, which stamps the stop request the channels and relays respect. A migration that holds nothing, or none at all, leaves the wake and the sleep to go through.
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

function setup(hold: InfraAgent["runtimeMigrationHold"], owned = true) {
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
  const wake = vi.fn(async () => ({
    ok: false as const,
    error: { type: "AgentNotFound" as const },
  }));
  const requestSleep = vi.fn(async () => null);
  const requestStop = vi.fn(async () => null);
  const setDisabled = vi.fn(async () => null);
  const agents = createAgentsService({
    owner: "owner-1",
    agentIdleTimeoutMinutes: { container: 30, vm: 5 },
    repo: unused<AgentsDeps["repo"]>({
      isOwnedBy: async () => owned,
      get: async () => agent,
      wake,
      requestSleep,
      requestStop,
      setDisabled,
    }),
  } as Partial<AgentsDeps> as AgentsDeps);
  return { agents, wake, requestSleep, requestStop, setDisabled };
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

describe("putting an agent to sleep during a runtime migration", () => {
  // TEST_SCENARIO: while the migration holds the Agent, a sleep is refused before anything is written: every wake is refused until the move ends, so nothing could undo it.
  it.each(["migrating", "failed"] as const)(
    "is refused while the migration is %s",
    async (hold) => {
      const { agents, requestSleep } = setup(hold);
      await expect(agents.sleep("agent-1")).rejects.toMatchObject({
        code: "CONFLICT",
      });
      expect(requestSleep).not.toHaveBeenCalled();
    },
  );

  // TEST_SCENARIO: with no migration, or one in its preflight where the container still runs, the sleep reaches the repository as any sleep does.
  it.each(["none", undefined] as const)(
    "goes through with hold %s",
    async (hold) => {
      const { agents, requestSleep } = setup(hold);
      await agents.sleep("agent-1");
      expect(requestSleep).toHaveBeenCalledOnce();
    },
  );
});

describe("stopping an agent", () => {
  // TEST_SCENARIO: 0.2.23's Stop is back for the release: with no migration holding the Agent it reaches the repository, whose stop request keeps channels and relays from waking it until its owner starts it or a schedule fires.
  it("stamps the stop request with no migration", async () => {
    const { agents, requestStop } = setup("none");
    await agents.stop("agent-1");
    expect(requestStop).toHaveBeenCalledWith("agent-1");
  });

  // TEST_SCENARIO: a migration holds the Agent down, so the stop is refused before anything is written; nothing could undo it until the move ends.
  it.each(["migrating", "failed"] as const)(
    "is refused while the migration is %s",
    async (hold) => {
      const { agents, requestStop } = setup(hold);
      await expect(agents.stop("agent-1")).rejects.toMatchObject({
        code: "CONFLICT",
      });
      expect(requestStop).not.toHaveBeenCalled();
    },
  );

  // TEST_SCENARIO: another user's Agent answers as not found, and nothing is written.
  it("is the owner's alone", async () => {
    const { agents, requestStop } = setup("none", false);
    expect(await agents.stop("agent-1")).toBeNull();
    expect(requestStop).not.toHaveBeenCalled();
  });
});

describe("disabling an agent during a runtime migration", () => {
  // TEST_SCENARIO: while the migration holds the Agent, a disable or an enable answers RuntimeMigrating and writes nothing.
  it.each(["migrating", "failed"] as const)(
    "is refused while the migration is %s",
    async (hold) => {
      const { agents, setDisabled } = setup(hold);
      expect(await agents.setDisabled("agent-1", true)).toEqual({
        ok: false,
        error: { type: "RuntimeMigrating" },
      });
      expect(setDisabled).not.toHaveBeenCalled();
    },
  );

  // TEST_SCENARIO: with no migration holding the Agent, the disable reaches the repository; an Agent gone by then answers AgentNotFound.
  it("goes through with no migration", async () => {
    const { agents, setDisabled } = setup("none");
    expect(await agents.setDisabled("agent-1", true)).toEqual({
      ok: false,
      error: { type: "AgentNotFound" },
    });
    expect(setDisabled).toHaveBeenCalledWith("agent-1", true);
  });
});
