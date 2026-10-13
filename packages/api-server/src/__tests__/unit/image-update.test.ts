// TEST_OVERVIEW: the platform keeps every Agent created from a Template on
// TEST_OVERVIEW: that Template's current image by itself, the retired
// TEST_OVERVIEW: per-harness images included, on both Backends. An Agent
// TEST_OVERVIEW: created on an image of its own is never moved. A down Agent
// TEST_OVERVIEW: moves at once; an always-on Agent moves only when every idle
// TEST_OVERVIEW: signal agrees; any other running Agent waits to hibernate.
// TEST_OVERVIEW: The harness carries over the way the UI's Update does, and
// TEST_OVERVIEW: the write names the version it decided from. A move that
// TEST_OVERVIEW: cannot start on the new image is moved back, and that image
// TEST_OVERVIEW: is not tried again for that Agent.
import { describe, it, expect, vi } from "vitest";
import type { TemplateSpec } from "api-server-api";
import { configureLogger } from "../../core/logger.js";
import {
  parseInfraAgent,
  type InfraAgent,
} from "../../modules/agents/infrastructure/agent-mappers.js";
import type { RuntimeMigrationWrite } from "../../modules/agents/infrastructure/agents-repository.js";
import {
  createImageUpdate,
  imageMove,
} from "../../modules/agents/services/image-update.js";
import { templateImageUpdate } from "../../modules/agents/domain/template-update.js";

configureLogger({ level: "error", write: () => {} });

const DEFAULT_IMAGE = "quay.io/dam-agents/default:abc";
const OLD_DEFAULT_IMAGE = "quay.io/dam-agents/default:old";
const FROM = "agent-platform.ai/image-update-from";
const REFUSED = "agent-platform.ai/image-update-refused";
const NOW = new Date("2026-10-12T12:00:00Z");
const TWO_HOURS_AGO = new Date("2026-10-12T10:00:00Z");
const IDLE_MIN = { container: 60, vm: 60 };

function agent(overrides?: Partial<InfraAgent>): InfraAgent {
  return {
    id: "agent-1",
    name: "my-agent",
    resourceVersion: "7",
    templateId: "default",
    spec: { name: "my-agent", image: OLD_DEFAULT_IMAGE },
    sweepable: false,
    lifetimeMs: 0,
    ready: false,
    hibernated: true,
    stopRequested: false,
    overBudget: false,
    podRestarts: 0,
    ...overrides,
  };
}

function alwaysOn(overrides?: Partial<InfraAgent>): InfraAgent {
  return agent({
    hibernated: false,
    ready: true,
    quietSince: TWO_HOURS_AGO,
    spec: {
      name: "my-agent",
      image: OLD_DEFAULT_IMAGE,
      hibernationTimeout: "0s",
    },
    ...overrides,
  });
}

function defaultTemplate(): { spec: TemplateSpec } {
  return {
    spec: {
      version: "agent-platform.ai/v1",
      image: DEFAULT_IMAGE,
      category: "harness",
      aliases: ["claude-code", "codex", "pi-agent", "bob"],
    },
  };
}

const knownTemplates = async (id: string) =>
  ["default", "claude-code", "codex", "pi-agent", "bob"].includes(id)
    ? defaultTemplate()
    : null;

function move(a: InfraAgent, templateImage = DEFAULT_IMAGE) {
  return imageMove(a, templateImage, IDLE_MIN, NOW);
}

function update(
  agents: InfraAgent[],
  opts?: {
    live?: (id: string) => InfraAgent | null;
    podIsIdle?: () => Promise<boolean>;
    readTemplateSpec?: (id: string) => Promise<{ spec: TemplateSpec } | null>;
  },
) {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const writeSpec = vi.fn(async (id: string, write: RuntimeMigrationWrite) => {
    const a = byId.get(id)!;
    return {
      ok: true as const,
      value: { ...a, spec: { ...a.spec, ...write.spec } },
    };
  });
  const log = vi.fn();
  const podIsIdle = vi.fn(opts?.podIsIdle ?? (async () => true));
  const tick = createImageUpdate({
    listAgents: async () => agents,
    getAgent: async (id) =>
      opts?.live ? opts.live(id) : (byId.get(id) ?? null),
    readTemplateSpec: opts?.readTemplateSpec ?? knownTemplates,
    writeSpec,
    podIsIdle,
    idleTimeoutMinutes: IDLE_MIN,
    log,
  }).tick;
  return { tick, writeSpec, podIsIdle, log };
}

describe("imageMove", () => {
  it.each([
    OLD_DEFAULT_IMAGE,
    "quay.io/dam-agents/claude-code:0.2.7",
    "quay.io/dam-agents/bob@sha256:0123",
  ])("moves a hibernated agent on %s now", (image) => {
    expect(move(agent({ spec: { name: "a", image } }))).toBe("now");
  });

  it("leaves an agent already on its template's image alone", () => {
    expect(
      move(agent({ spec: { name: "a", image: DEFAULT_IMAGE } })),
    ).toBeNull();
  });

  // TEST_SCENARIO: an agent that failed to start on an image was moved back;
  // TEST_SCENARIO: trying it again would strand it on every tick.
  it("does not try again an image the agent refused", () => {
    expect(move(agent({ imageUpdateRefused: DEFAULT_IMAGE }))).toBeNull();
    expect(move(agent({ imageUpdateRefused: "quay.io/x:older" }))).toBe("now");
  });

  it("moves an over-budget agent now, which no restart serves", () => {
    expect(move(agent({ hibernated: false, overBudget: true }))).toBe("now");
  });

  // TEST_SCENARIO: the vm-runner keeps a machine's root when the new image
  // TEST_SCENARIO: declares the same root generation, and the platform
  // TEST_SCENARIO: accepts a fresh root otherwise, so a vm agent moves too.
  it("moves a hibernated vm agent", () => {
    expect(
      move(
        agent({
          spec: {
            name: "a",
            image: OLD_DEFAULT_IMAGE,
            backend: { type: "vm" },
          },
        }),
      ),
    ).toBe("now");
  });

  // TEST_SCENARIO: an image change restarts a running agent, so an agent
  // TEST_SCENARIO: that hibernates by itself waits for the idle checker.
  it("waits for a running agent that hibernates to hibernate", () => {
    expect(
      move(
        agent({ hibernated: false, ready: true, quietSince: TWO_HOURS_AGO }),
      ),
    ).toBeNull();
  });

  it("moves a quiet always-on agent once its pod says idle", () => {
    expect(move(alwaysOn())).toBe("if-pod-idle");
  });

  it("treats every agent as always-on when the install never hibernates", () => {
    expect(
      imageMove(
        agent({ hibernated: false, ready: true, quietSince: TWO_HOURS_AGO }),
        DEFAULT_IMAGE,
        { container: 0, vm: 0 },
        NOW,
      ),
    ).toBe("if-pod-idle");
  });

  // TEST_SCENARIO: a vm agent's idle timeout is the install's, so its own
  // TEST_SCENARIO: override does not make it always-on.
  it("waits for a vm agent with a never-hibernate override to hibernate", () => {
    expect(
      move(
        alwaysOn({
          spec: {
            name: "a",
            image: OLD_DEFAULT_IMAGE,
            hibernationTimeout: "0s",
            backend: { type: "vm" },
          },
        }),
      ),
    ).toBeNull();
  });

  // TEST_SCENARIO: an open connection or an Invocation pin clears quietSince,
  // TEST_SCENARIO: and recent activity means the user may be back any moment.
  it.each([
    ["an open connection or pin", undefined],
    ["recent activity", new Date("2026-10-12T11:30:00Z")],
  ])("leaves an always-on agent with %s alone", (_, quietSince) => {
    expect(
      move(alwaysOn(quietSince ? { quietSince } : { quietSince: undefined })),
    ).toBeNull();
  });

  it("leaves an agent with a storage migration under way alone", () => {
    expect(move(agent({ storageMigrating: true }))).toBeNull();
  });
});

describe("image update tick", () => {
  // TEST_SCENARIO: the case this job exists for: a deploy ships a new
  // TEST_SCENARIO: default image, and an Agent created on the old one reaches
  // TEST_SCENARIO: it without its owner clicking Update.
  it("moves an agent on an older default image and records where it came from", async () => {
    const m = update([
      agent({ spec: { name: "a", image: OLD_DEFAULT_IMAGE } }),
    ]);
    await m.tick();
    expect(m.writeSpec).toHaveBeenCalledWith("agent-1", {
      spec: { image: DEFAULT_IMAGE },
      annotations: { [FROM]: OLD_DEFAULT_IMAGE },
      resourceVersion: "7",
    });
  });

  it.each([
    ["claude-code", "claude-code"],
    ["codex", "codex"],
    ["pi-agent", "pi"],
    ["bob", "bob"],
  ])(
    "moves a %s agent to the default image with harness %s",
    async (templateId, harness) => {
      const m = update([
        agent({
          templateId,
          spec: { name: "a", image: `quay.io/dam-agents/${templateId}:old` },
        }),
      ]);
      await m.tick();
      expect(m.writeSpec.mock.calls[0]![1].spec).toEqual({
        image: DEFAULT_IMAGE,
        harness,
      });
    },
  );

  it("keeps a harness the agent already chose", async () => {
    const m = update([
      agent({
        templateId: "claude-code",
        spec: {
          name: "a",
          image: "quay.io/dam-agents/claude-code:old",
          harness: "codex",
        },
      }),
    ]);
    await m.tick();
    expect(m.writeSpec.mock.calls[0]![1].spec).toEqual({
      image: DEFAULT_IMAGE,
      harness: "codex",
    });
  });

  // TEST_SCENARIO: a move over an earlier one the agent never started on
  // TEST_SCENARIO: keeps the image it last ran, the one known to start.
  it("keeps the image an unproven earlier move came from", async () => {
    const m = update([
      agent({
        imageUpdateFrom: "quay.io/dam-agents/default:older",
      }),
    ]);
    await m.tick();
    expect(m.writeSpec.mock.calls[0]![1].annotations).toEqual({
      [FROM]: "quay.io/dam-agents/default:older",
    });
  });

  // TEST_SCENARIO: an agent created on an image of its own, a starter kit's
  // TEST_SCENARIO: included, carries no Template, and one whose Template the
  // TEST_SCENARIO: install no longer has has nothing to move to.
  it("leaves custom-image agents and agents of a removed template alone", async () => {
    const m = update([
      agent({
        id: "custom",
        templateId: undefined,
        spec: { name: "a", image: "us.icr.io/team/bob:1" },
      }),
      agent({
        id: "gone",
        templateId: "nous",
        spec: { name: "a", image: "quay.io/dam-agents/nous:1" },
      }),
    ]);
    await m.tick();
    expect(m.writeSpec).not.toHaveBeenCalled();
  });

  it("does not probe a hibernated agent's pod", async () => {
    const m = update([agent()]);
    await m.tick();
    expect(m.podIsIdle).not.toHaveBeenCalled();
    expect(m.writeSpec).toHaveBeenCalledOnce();
  });

  it("restarts a quiet always-on agent whose pod reports idle", async () => {
    const m = update([alwaysOn()]);
    await m.tick();
    expect(m.podIsIdle).toHaveBeenCalledWith("agent-1");
    expect(m.writeSpec).toHaveBeenCalledOnce();
  });

  // TEST_SCENARIO: the pod's idle flag covers a running turn, queued prompts,
  // TEST_SCENARIO: an open terminal and kept background work; any of them
  // TEST_SCENARIO: keeps the agent where it is, and so does a failed probe.
  it.each([
    ["is busy", async () => false],
    ["cannot be reached", () => Promise.reject(new Error("refused"))],
  ])("leaves an always-on agent whose pod %s", async (_, podIsIdle) => {
    const m = update([alwaysOn()], { podIsIdle });
    await m.tick();
    expect(m.writeSpec).not.toHaveBeenCalled();
  });

  it("skips running agents that hibernate", async () => {
    const m = update([agent({ hibernated: false, ready: true })]);
    await m.tick();
    expect(m.writeSpec).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: the listing comes from a cache; an agent that woke since
  // TEST_SCENARIO: is running on the live read and must not be restarted.
  it("decides again on the live read", async () => {
    const m = update([agent()], {
      live: () => agent({ hibernated: false, ready: true }),
    });
    await m.tick();
    expect(m.writeSpec).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: the template's image changed between the listing and the
  // TEST_SCENARIO: upgrade; the confirmed target no longer holds.
  it("refuses a move whose template moved in between", async () => {
    let reads = 0;
    const m = update([agent()], {
      readTemplateSpec: async () =>
        reads++ === 0
          ? defaultTemplate()
          : { spec: { ...defaultTemplate().spec, image: "repo:newer" } },
    });
    await m.tick();
    expect(m.writeSpec).not.toHaveBeenCalled();
    expect(m.log).toHaveBeenCalledWith(
      "[image-update] agent-1 refused: TemplateMoved",
    );
  });

  it("does nothing without the agent's template", async () => {
    const m = update([agent()], { readTemplateSpec: async () => null });
    await m.tick();
    expect(m.writeSpec).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: once the agent has stayed ready on the new image the
  // TEST_SCENARIO: move is proven and the image it came from is forgotten.
  it("forgets the old image once the agent stayed ready on the new one", async () => {
    const m = update([
      agent({
        spec: { name: "a", image: DEFAULT_IMAGE },
        imageUpdateFrom: OLD_DEFAULT_IMAGE,
        specStart: "ready",
        readySince: TWO_HOURS_AGO,
      }),
    ]);
    await m.tick();
    expect(m.writeSpec).toHaveBeenCalledExactlyOnceWith("agent-1", {
      annotations: { [FROM]: null },
      resourceVersion: "7",
    });
  });

  // TEST_SCENARIO: a container that crashes some seconds after it becomes
  // TEST_SCENARIO: ready is ready for a moment between its exits. That
  // TEST_SCENARIO: moment must not prove the move, or the crash loop the
  // TEST_SCENARIO: controller reports next has no old image to go back to.
  it("keeps the old image while the agent has only just become ready", async () => {
    const m = update([
      agent({
        spec: { name: "a", image: DEFAULT_IMAGE },
        imageUpdateFrom: OLD_DEFAULT_IMAGE,
        specStart: "ready",
        readySince: new Date(Date.now() - 60_000),
      }),
    ]);
    await m.tick();
    expect(m.writeSpec).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: a new image that cannot be pulled, unpacked or kept
  // TEST_SCENARIO: running would leave the agent unable to start; it goes
  // TEST_SCENARIO: back to the image it last ran, and the new one is refused.
  it("moves an agent that cannot start on the new image back", async () => {
    const m = update([
      agent({
        hibernated: false,
        spec: { name: "a", image: DEFAULT_IMAGE },
        imageUpdateFrom: OLD_DEFAULT_IMAGE,
        specStart: "failed",
      }),
    ]);
    await m.tick();
    expect(m.writeSpec).toHaveBeenCalledExactlyOnceWith("agent-1", {
      spec: { image: OLD_DEFAULT_IMAGE },
      annotations: { [FROM]: null, [REFUSED]: DEFAULT_IMAGE },
      resourceVersion: "7",
    });
  });

  it("waits while a moved agent has not started on its new image", async () => {
    const m = update([
      agent({
        spec: { name: "a", image: DEFAULT_IMAGE },
        imageUpdateFrom: OLD_DEFAULT_IMAGE,
      }),
    ]);
    await m.tick();
    expect(m.writeSpec).not.toHaveBeenCalled();
  });
});

describe("parseInfraAgent", () => {
  const parse = (
    annotations: Record<string, string>,
    status?: Record<string, unknown>,
  ) =>
    parseInfraAgent({
      metadata: { name: "agent-1", generation: 3, annotations },
      spec: { image: DEFAULT_IMAGE },
      status,
    });
  const last = { "agent-platform.ai/last-activity": "2026-10-12T10:00:00Z" };
  const agentPod = (reason: string, observedGeneration = 3) => ({
    type: "AgentPodReady",
    status: "False",
    reason,
    observedGeneration,
  });

  it("is quiet since the last activity when nothing holds the agent", () => {
    expect(parse(last).quietSince).toEqual(TWO_HOURS_AGO);
  });

  it.each([
    ["an open connection", "agent-platform.ai/active-session"],
    ["an Invocation pin", "agent-platform.ai/invocations-active"],
  ])("is not quiet under %s", (_, key) => {
    expect(parse({ ...last, [key]: "true" }).quietSince).toBeUndefined();
  });

  it("is not quiet without a readable activity stamp", () => {
    expect(
      parse({ "agent-platform.ai/last-activity": "garbage" }).quietSince,
    ).toBeUndefined();
  });

  it("reads the image update annotations", () => {
    const parsed = parse({ [FROM]: "a:1", [REFUSED]: "a:2" });
    expect(parsed.imageUpdateFrom).toBe("a:1");
    expect(parsed.imageUpdateRefused).toBe("a:2");
  });

  // TEST_SCENARIO: a condition the controller wrote for an older spec says
  // TEST_SCENARIO: nothing about the image the spec names now.
  it("reads a start only from conditions about the current spec", () => {
    const ready = (observedGeneration: number) => ({
      conditions: [{ type: "Ready", status: "True", observedGeneration }],
    });
    expect(parse({}, ready(3)).specStart).toBe("ready");
    expect(parse({}, ready(2)).specStart).toBeUndefined();
    expect(
      parse({}, { conditions: [agentPod("ImagePullFailure", 2)] }).specStart,
    ).toBeUndefined();
  });

  // TEST_SCENARIO: the controller says StartFailed only of the pod or
  // TEST_SCENARIO: machine that runs the spec its generation names, so a
  // TEST_SCENARIO: crash loop or a harness that never becomes ready on the
  // TEST_SCENARIO: new image moves the agent back, while one about an older
  // TEST_SCENARIO: spec does not.
  it.each(["CrashLoop", "NeverReady"])(
    "reads StartFailed %s on the current spec as a failed start",
    (reason) => {
      const startFailed = (observedGeneration: number) => ({
        conditions: [
          agentPod("ContainerTerminated"),
          { type: "StartFailed", status: "True", reason, observedGeneration },
        ],
      });
      expect(parse({}, startFailed(3)).specStart).toBe("failed");
      expect(parse({}, startFailed(2)).specStart).toBeUndefined();
    },
  );

  it("reads since when the agent is ready", () => {
    const parsed = parse(
      {},
      {
        conditions: [
          {
            type: "Ready",
            status: "True",
            observedGeneration: 3,
            lastTransitionTime: "2026-10-12T10:00:00Z",
          },
        ],
      },
    );
    expect(parsed.readySince).toEqual(TWO_HOURS_AGO);
  });

  it.each(["ImagePullFailure", "MachineImageUnavailable", "MachineBootFailed"])(
    "reads %s as a failed start",
    (reason) => {
      expect(parse({}, { conditions: [agentPod(reason)] }).specStart).toBe(
        "failed",
      );
    },
  );

  // TEST_SCENARIO: the pod a roll replaces exits on SIGTERM at the new
  // TEST_SCENARIO: generation, and memory fails on any image, so neither
  // TEST_SCENARIO: says the new image is bad without the controller's
  // TEST_SCENARIO: StartFailed about the current pod.
  it.each(["ContainerTerminated", "OutOfMemory"])(
    "does not read %s as a failed start",
    (reason) => {
      expect(
        parse({}, { conditions: [agentPod(reason)], agentPodRestarts: 3 })
          .specStart,
      ).toBeUndefined();
    },
  );
});

describe("templateImageUpdate", () => {
  // TEST_SCENARIO: the owner is told why an agent stays behind, rather than
  // TEST_SCENARIO: that it will move by itself, once that image failed it.
  it("says the update failed to start only for the refused image", () => {
    expect(
      templateImageUpdate(OLD_DEFAULT_IMAGE, DEFAULT_IMAGE, DEFAULT_IMAGE),
    ).toEqual({
      fromImage: OLD_DEFAULT_IMAGE,
      toImage: DEFAULT_IMAGE,
      startFailed: true,
    });
    expect(
      templateImageUpdate(OLD_DEFAULT_IMAGE, DEFAULT_IMAGE, "a:older"),
    ).toEqual({ fromImage: OLD_DEFAULT_IMAGE, toImage: DEFAULT_IMAGE });
  });
});
