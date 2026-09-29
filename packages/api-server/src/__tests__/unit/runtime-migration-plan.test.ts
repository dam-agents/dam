// TEST_OVERVIEW: what the platform tells a user about a runtime migration. The plan
// TEST_OVERVIEW: says, before anything is written, which persisted paths cannot move,
// TEST_OVERVIEW: how big the disk becomes, whether a sleeping agent is started, how
// TEST_OVERVIEW: long the old volumes are kept, and why a move is refused. While the
// TEST_OVERVIEW: move runs, the agent reads as migrating, and a wake refused for it
// TEST_OVERVIEW: reads as "try again in a few minutes" rather than as a timeout.
import { describe, expect, it } from "vitest";
import {
  runtimeMigrationRefusalReasons,
  toRuntimeMigrationPlanView,
  type AgentSpec,
  type RuntimeMigration,
  type RuntimeMigrationPhase,
} from "api-server-api";

import { goDurationMs } from "../../duration.js";
import { runtimeMigrationPlan } from "../../modules/agents/domain/runtime-migration-plan.js";
import {
  AgentWakeTimeoutError,
  describeWakeFailure,
  wakeFailureReasonToken,
} from "../../modules/agents/domain/wake-failure.js";
import {
  computeAgentState,
  type InfraAgent,
} from "../../modules/agents/infrastructure/agent-mappers.js";
import { wakeFailureUserCopy } from "../../modules/channels/infrastructure/wake-failure-copy.js";
import { runtimeMigrationHold } from "../../modules/agents/domain/runtime-migration.js";

const WEEK_MS = 7 * 24 * 3600_000;

const INPUTS = {
  virtualizationEnabled: true,
  defaultMounts: [{ path: "/home/agent", persist: true }],
  defaultStorageSize: "10Gi",
  retentionMs: WEEK_MS,
};

function agent(
  spec: Partial<AgentSpec>,
  extra?: {
    hibernated?: boolean;
    stopRequested?: boolean;
    storageMigrating?: boolean;
  },
) {
  return {
    spec: { name: "a", image: "img", ...spec } as AgentSpec,
    hibernated: extra?.hibernated ?? false,
    stopRequested: extra?.stopRequested ?? false,
    ...(extra?.storageMigrating ? { storageMigrating: true } : {}),
  };
}

describe("the runtime migration plan", () => {
  // TEST_SCENARIO: an agent whose HOME mount asks for more than its storageSize. The plan sizes the disk for HOME's volume, as the container backend sized it, and says the old volumes are kept for the install's window.
  it("sizes the disk for HOME and names the retention window", () => {
    const plan = runtimeMigrationPlan(
      agent({
        mounts: [
          { path: "/home/agent", persist: true, size: "16Gi" },
          { path: "/tmp", persist: false },
        ],
      }),
      INPUTS,
    );
    expect(plan).toEqual({
      unmovable: [],
      storageSize: "16Gi",
      storageResized: true,
      bootsSleepingAgent: false,
      retentionMs: WEEK_MS,
      refusal: null,
    });
  });

  it("keeps the disk the agent asks for when HOME names no size", () => {
    const plan = runtimeMigrationPlan(
      agent({
        storageSize: "20Gi",
        mounts: [{ path: "/home/agent", persist: true }],
      }),
      INPUTS,
    );
    expect(plan.storageSize).toBe("20Gi");
    expect(plan.storageResized).toBe(false);
  });

  // TEST_SCENARIO: the controller boots the machine once even for an agent that was asleep, because only a guest that answered proves the copy; the user has to know that the move spends budget.
  it("says a sleeping or stopped agent will be started", () => {
    expect(
      runtimeMigrationPlan(agent({}, { hibernated: true }), INPUTS)
        .bootsSleepingAgent,
    ).toBe(true);
    expect(
      runtimeMigrationPlan(agent({}, { stopRequested: true }), INPUTS)
        .bootsSleepingAgent,
    ).toBe(true);
  });

  // TEST_SCENARIO: a path the new runtime cannot carry must be named with its reason before the user clicks, in the same words the migrate request refuses with.
  it("names each unmovable path and refuses with the same reasons", () => {
    const plan = runtimeMigrationPlan(
      agent({
        mounts: [
          { path: "/home/agent", persist: true },
          { path: "/data", persist: true },
        ],
      }),
      INPUTS,
    );
    expect(plan.unmovable.map((u) => u.path)).toEqual(["/data"]);
    expect(plan.refusal?.type).toBe("PersistsUnmovablePaths");
    const view = toRuntimeMigrationPlanView(plan);
    expect(view.allowed).toBe(false);
    expect(view.refusal?.reasons).toEqual([
      "/data cannot be moved: the new runtime keeps only the home directory",
    ]);
  });

  it("refuses an agent whose storage is being migrated", () => {
    const view = toRuntimeMigrationPlanView(
      runtimeMigrationPlan(agent({}, { storageMigrating: true }), INPUTS),
    );
    expect(view.allowed).toBe(false);
    expect(view.refusal?.reasons[0]).toMatch(/storage is being migrated/);
  });

  it("marks an agent with nothing in the way as allowed", () => {
    const view = toRuntimeMigrationPlanView(
      runtimeMigrationPlan(agent({}), INPUTS),
    );
    expect(view.allowed).toBe(true);
    expect(view.refusal).toBeNull();
  });

  it("gives one sentence for every refusal the request can return", () => {
    expect(runtimeMigrationRefusalReasons({ type: "AlreadyOnVm" })).toEqual([
      "This agent already runs on the new runtime",
    ]);
    expect(
      runtimeMigrationRefusalReasons({ type: "VirtualizationDisabled" }),
    ).toHaveLength(1);
    expect(
      runtimeMigrationRefusalReasons({ type: "RuntimeMigrationInProgress" }),
    ).toEqual(["This agent is already moving to the new runtime"]);
    expect(
      runtimeMigrationRefusalReasons({ type: "HomeNotPersisted" }),
    ).toEqual([
      "This agent does not keep its home directory, so there is nothing for the new runtime to carry over",
    ]);
    expect(
      runtimeMigrationRefusalReasons({ type: "ConcurrentUpdate" }),
    ).toEqual([
      "This agent changed while the move was being requested — try again",
    ]);
  });

  // TEST_SCENARIO: an agent whose home is not persisted has nothing the machine would keep; the plan says so before the user clicks, in the request's own words.
  it("refuses an agent that does not persist its home", () => {
    const view = toRuntimeMigrationPlanView(
      runtimeMigrationPlan(
        agent({ mounts: [{ path: "/home/agent", persist: false }] }),
        INPUTS,
      ),
    );
    expect(view.allowed).toBe(false);
    expect(view.refusal?.type).toBe("HomeNotPersisted");
  });

  // TEST_SCENARIO: an agent that names no mounts gets the install's template defaults from the controller, so the plan refuses a default that persists a path besides HOME, as the request would.
  it("plans from the install's default mounts when the agent names none", () => {
    const plan = runtimeMigrationPlan(agent({}), {
      ...INPUTS,
      defaultMounts: [
        { path: "/home/agent", persist: true },
        { path: "/data", persist: true, size: "5Gi" },
      ],
    });
    expect(plan.unmovable.map((u) => u.path)).toEqual(["/data"]);
    expect(plan.refusal?.type).toBe("PersistsUnmovablePaths");
  });
});

describe("the retention window", () => {
  it("reads the chart's Go duration", () => {
    expect(goDurationMs("168h")).toBe(WEEK_MS);
    expect(goDurationMs("1h30m")).toBe(90 * 60_000);
    expect(goDurationMs("0")).toBe(0);
  });

  // TEST_SCENARIO: the controller keeps a volume whose window it cannot read, so the plan must not show a made-up window either.
  it("reads anything else as unknown", () => {
    expect(goDurationMs("7d")).toBeNull();
    expect(goDurationMs("")).toBeNull();
    expect(goDurationMs("168h garbage")).toBeNull();
  });
});

describe("an agent mid-migration", () => {
  const base = {
    ready: false,
    hibernated: false,
    overBudget: false,
  } as InfraAgent;

  // TEST_SCENARIO: the controller holds a migrating agent down, so without its own state it reads as starting and the chat waits on a wake that will not come.
  it("reads as migrating while the migration holds it", () => {
    expect(
      computeAgentState({ ...base, runtimeMigrationHold: "migrating" }),
    ).toBe("migrating");
    expect(computeAgentState({ ...base, runtimeMigrationHold: "failed" })).toBe(
      "migrating",
    );
  });

  // TEST_SCENARIO: through the preflight the container keeps running, so the agent reads as its container does.
  it("reads as its container while nothing is held", () => {
    expect(
      computeAgentState({ ...base, ready: true, runtimeMigrationHold: "none" }),
    ).toBe("running");
  });

  it("still reads a reconcile error as an error", () => {
    expect(
      computeAgentState({
        ...base,
        error: "bad spec",
        runtimeMigrationHold: "migrating",
      }),
    ).toBe("error");
  });

  it("reads as starting again once the migration is done", () => {
    expect(computeAgentState(base)).toBe("starting");
  });

  // TEST_SCENARIO: a Slack or Telegram message to a migrating agent gets a short reply that says why and when to try again, not the generic wake timeout.
  it("turns a refused wake into a try-again-shortly reply", () => {
    const failure = { kind: "migrating" } as const;
    expect(wakeFailureUserCopy(failure)).toBe(
      "This agent is moving to the new runtime — try again in a few minutes.",
    );
    expect(wakeFailureReasonToken(failure)).toBe("wake-rejected:migrating");
    expect(describeWakeFailure(failure)).toBe(
      "the agent is moving to the new runtime",
    );
    expect(
      new AgentWakeTimeoutError({
        agentId: "a1",
        timeoutMs: 120_000,
        durationMs: 0,
        failure,
      }).message,
    ).toBe("agent a1 was not started: the agent is moving to the new runtime");
  });
});

describe("what a migration holds", () => {
  const phase = (p: RuntimeMigrationPhase): RuntimeMigration => ({
    phase: p,
    abortable: false,
    retryable: false,
  });

  // TEST_SCENARIO: the controller keeps the container running through the preflight, brings it back on an abort, and the machine answers once verified; none of these should refuse a wake.
  it("holds nothing through the preflight, an abort or a verified boot", () => {
    expect(runtimeMigrationHold(undefined, false)).toBe("none");
    expect(runtimeMigrationHold(phase("requested"), false)).toBe("none");
    expect(runtimeMigrationHold(phase("aborting"), true)).toBe("none");
    expect(runtimeMigrationHold(phase("verified"), true)).toBe("none");
  });

  it("holds the agent from the stop until the machine has booted from the copy", () => {
    expect(runtimeMigrationHold(phase("stopping"), false)).toBe("migrating");
    expect(runtimeMigrationHold(phase("copying"), true)).toBe("migrating");
    expect(runtimeMigrationHold(phase("booting"), true)).toBe("migrating");
  });

  // TEST_SCENARIO: a failure after the stop keeps the container stopped until the owner retries or aborts; a preflight failure never stopped it, so the agent still answers.
  it("holds a failed migration only when it had stopped the container", () => {
    expect(runtimeMigrationHold(phase("failed"), true)).toBe("failed");
    expect(runtimeMigrationHold(phase("failed"), false)).toBe("none");
  });

  // TEST_SCENARIO: a move that failed after the stop waits on its owner, so a channel reply must not promise it comes back by itself.
  it("says a failed move waits on the owner", () => {
    const failure = { kind: "migration-failed" } as const;
    expect(wakeFailureUserCopy(failure)).toMatch(
      /failed, and it stays stopped until its owner retries or aborts/,
    );
    expect(wakeFailureReasonToken(failure)).toBe(
      "wake-rejected:migration-failed",
    );
  });
});
