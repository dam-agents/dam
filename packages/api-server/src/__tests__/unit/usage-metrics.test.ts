/** TEST_OVERVIEW: the usage counters that let the telemetry store answer what
 *  the platform is used for — one series per measurement, fed from the bus,
 *  carrying no identifier of the person or agent behind the interaction. */
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  InstrumentType,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emit, EventType } from "../../events.js";
import { composeUsageMetricsModule } from "../../modules/usage-metrics/index.js";
import { withGaugeDeltaTemporality } from "../../telemetry-temporality.js";
import type {
  AgentHarness,
  StateCountsReader,
} from "../../modules/usage-metrics/index.js";

const DAY_ONE = Date.parse("2026-09-14T09:00:00Z");
const DAY_TWO = Date.parse("2026-09-15T01:00:00Z");

describe("usage metrics", () => {
  let reader: PeriodicExportingMetricReader;
  let meterProvider: MeterProvider;
  let usageMetrics: ReturnType<typeof composeUsageMetricsModule>;
  let clock = DAY_ONE;
  let harnesses = new Map<string, AgentHarness>();
  let stateCounts: StateCountsReader;

  function start(knownHarnesses: string[] = ["claude-code", "codex"]): void {
    usageMetrics = composeUsageMetricsModule({
      meter: meterProvider.getMeter("test"),
      stateCounts,
      harnessOf: (agentId) => harnesses.get(agentId) ?? { agent: "unresolved" },
      knownHarnesses: new Set(knownHarnesses),
      now: () => clock,
    });
    usageMetrics.start();
  }

  async function points(name: string) {
    const { resourceMetrics } = await reader.collect();
    const metric = resourceMetrics.scopeMetrics
      .flatMap((scope) => scope.metrics)
      .find((m) => m.descriptor.name === name);
    return (metric?.dataPoints ?? []).map((p) => ({
      attributes: p.attributes as Record<string, string>,
      value: p.value as number,
    }));
  }

  async function seriesOf(name: string, key: string) {
    return new Map(
      (await points(name)).map((p) => [String(p.attributes[key]), p.value]),
    );
  }

  async function attributeKeys(name: string): Promise<string[][]> {
    return (await points(name)).map((p) => Object.keys(p.attributes).sort());
  }

  async function exportedNames(): Promise<string[]> {
    const { resourceMetrics } = await reader.collect();
    return resourceMetrics.scopeMetrics
      .flatMap((scope) => scope.metrics)
      .map((m) => m.descriptor.name)
      .sort();
  }

  beforeEach(() => {
    clock = DAY_ONE;
    harnesses = new Map<string, AgentHarness>([
      ["agent-1", { agent: "resolved", harness: "claude-code" }],
    ]);
    stateCounts = {
      liveAgents: async () => [
        { id: "agent-1", starterKit: "kit-a", spawnedByAgentId: null },
        { id: "agent-2", starterKit: null, spawnedByAgentId: null },
        { id: "agent-3", starterKit: null, spawnedByAgentId: "agent-1" },
      ],
      slackWorkspacesByState: async () => [{ state: "active", count: 2 }],
      activeKbShares: async () => 3,
      skillSets: async () => 4,
    };
    reader = new PeriodicExportingMetricReader({
      exporter: withGaugeDeltaTemporality(
        new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
        { InstrumentType, AggregationTemporality },
      ),
      exportIntervalMillis: 3_600_000,
    });
    meterProvider = new MeterProvider({ readers: [reader] });
  });

  afterEach(async () => {
    usageMetrics.stop();
    await meterProvider.shutdown();
  });

  /** TEST_SCENARIO: a turn counts the same whichever transport carried it, and
   *  each surface keeps its own series — comparing surfaces is the point. */
  it("counts relay turns and channel turns on one counter", async () => {
    start();

    emit({
      type: EventType.SessionTurnRelayed,
      agentId: "agent-1",
      actorSub: "user-1",
      surface: "ui",
    });
    emit({
      type: EventType.ChannelTurnRelayed,
      channel: "slack",
      agentId: "agent-1",
      actorSub: null,
      outcome: "success",
    });
    emit({
      type: EventType.ChannelTurnRelayed,
      channel: "telegram",
      agentId: "agent-1",
      actorSub: null,
      outcome: "failure",
    });

    expect(
      await seriesOf("platform.turn.total", "platform.turn.surface"),
    ).toEqual(
      new Map([
        ["ui", 1],
        ["slack", 1],
        ["telegram", 1],
      ]),
    );
  });

  /** TEST_SCENARIO: the events type their surface as a bare string, so an
   *  unrecognized value must fall into a known bucket rather than mint a new
   *  time series per value. */
  it("folds an unrecognized surface into the other bucket", async () => {
    start();

    emit({
      type: EventType.SessionTurnRelayed,
      agentId: "agent-1",
      actorSub: "user-1",
      surface: "surface-that-does-not-exist",
    });

    expect(
      await seriesOf("platform.turn.total", "platform.turn.surface"),
    ).toEqual(new Map([["other", 1]]));
  });

  /** TEST_SCENARIO: the harness answers what the traffic ran on. A session
   *  names its own; otherwise the agent's harness stands in. Each way of not
   *  knowing it is its own bucket: an agent with none reads as none, an agent
   *  the cache cannot resolve is unknown, and a harness this install does not
   *  carry folds to other — so cardinality stays bounded by the catalog. */
  it("labels each turn with a bounded harness", async () => {
    harnesses.set("agent-image", { agent: "resolved" });
    harnesses.set("agent-foreign", {
      agent: "resolved",
      harness: "retired-harness",
    });
    start();

    for (const agentId of [
      "agent-1",
      "agent-image",
      "agent-foreign",
      "agent-gone",
    ])
      emit({
        type: EventType.SessionTurnRelayed,
        agentId,
        actorSub: "user-1",
        surface: "ui",
      });
    emit({
      type: EventType.SessionTurnRelayed,
      agentId: "agent-1",
      actorSub: "user-1",
      surface: "ui",
      harness: "codex",
    });

    expect(
      await seriesOf("platform.turn.total", "platform.turn.harness"),
    ).toEqual(
      new Map([
        ["claude-code", 1],
        ["none", 1],
        ["other", 1],
        ["unknown", 1],
        ["codex", 1],
      ]),
    );
  });

  /** TEST_SCENARIO: the auth event fires on every authenticated request, so the
   *  counter must collapse to one per person per surface per UTC day — the
   *  active-day unit the activity log's dedup index also records. The identity
   *  doing the collapsing never leaves the process. */
  it("counts one actor-day per identity, surface and UTC day", async () => {
    start();

    for (const surface of ["ui", "ui", "cli"])
      emit({
        type: EventType.UserAuthenticated,
        userSub: "user-1",
        surface,
        isCore: false,
      });
    emit({
      type: EventType.UserAuthenticated,
      userSub: "user-2",
      surface: "ui",
      isCore: false,
    });

    expect(
      await seriesOf(
        "platform.actor.active_day.total",
        "platform.actor.surface",
      ),
    ).toEqual(
      new Map([
        ["ui", 2],
        ["cli", 1],
      ]),
    );
  });

  /** TEST_SCENARIO: the same person returning the next day is a new active day,
   *  or the number stops measuring activity and starts measuring signups. */
  it("counts the same identity again on the next UTC day", async () => {
    start();

    emit({
      type: EventType.UserAuthenticated,
      userSub: "user-1",
      surface: "ui",
      isCore: false,
    });
    clock = DAY_TWO;
    emit({
      type: EventType.UserAuthenticated,
      userSub: "user-1",
      surface: "ui",
      isCore: false,
    });

    expect(
      await seriesOf(
        "platform.actor.active_day.total",
        "platform.actor.surface",
      ),
    ).toEqual(new Map([["ui", 2]]));
  });

  /** TEST_SCENARIO: a schedule fire carries whether the trigger reached the
   *  agent, which is the one outcome the platform actually knows. */
  it("counts schedule fires with their mode, outcome and harness", async () => {
    start();

    emit({
      type: EventType.ScheduleFired,
      scheduleId: "sched-1",
      agentId: "agent-1",
      ownerSub: "user-1",
      mode: "fresh",
      outcome: "success",
    });
    emit({
      type: EventType.ScheduleFired,
      scheduleId: "sched-2",
      agentId: "agent-1",
      ownerSub: "user-1",
      mode: "continuous",
      outcome: "failure",
    });

    expect(await points("platform.schedule.fire.total")).toEqual([
      {
        attributes: {
          "platform.schedule.mode": "fresh",
          "platform.schedule.outcome": "success",
          "platform.schedule.harness": "claude-code",
        },
        value: 1,
      },
      {
        attributes: {
          "platform.schedule.mode": "continuous",
          "platform.schedule.outcome": "failure",
          "platform.schedule.harness": "claude-code",
        },
        value: 1,
      },
    ]);
  });

  /** TEST_SCENARIO: a connection names the provider it was made against, since
   *  the grant itself is destroyed on disconnect and the provider is the part
   *  anyone asks about. */
  it("counts connections added and removed by provider", async () => {
    start();

    emit({
      type: EventType.ConnectionCreated,
      actorSub: "user-1",
      connectionKey: "conn-1",
      templateId: "github",
      kind: "oauth_app",
    });
    emit({
      type: EventType.ConnectionRemoved,
      actorSub: "user-1",
      connectionKey: "conn-1",
      templateId: "github",
      kind: "oauth_app",
    });

    expect(
      await seriesOf(
        "platform.connection.change.total",
        "platform.connection.action",
      ),
    ).toEqual(
      new Map([
        ["added", 1],
        ["removed", 1],
      ]),
    );
  });

  /** TEST_SCENARIO: the provider rides on an event field rather than a closed
   *  union, so the counter caps how many distinct values it will ever emit —
   *  a catalog that grows unbounded later must not mint a series per value. */
  it("folds provider values past the cap into the other bucket", async () => {
    start();

    for (let i = 0; i < 70; i += 1)
      emit({
        type: EventType.ConnectionCreated,
        actorSub: "user-1",
        connectionKey: `conn-${i}`,
        templateId: `provider-${i}`,
        kind: "mcp",
      });

    const providers = await seriesOf(
      "platform.connection.change.total",
      "platform.connection.provider",
    );
    expect(providers.size).toBe(65);
    expect(providers.get("other")).toBe(6);
  });

  /** TEST_SCENARIO: import volume is counted for every attempt, but the bytes
   *  are only real when the import succeeded. */
  it("counts imports always and their bytes only on success", async () => {
    start();

    emit({
      type: EventType.FilesImported,
      actorSub: "user-1",
      agentId: "agent-1",
      surface: "ui",
      outcome: "success",
      bytes: 2048,
    });
    emit({
      type: EventType.FilesImported,
      actorSub: "user-1",
      agentId: "agent-1",
      surface: "ui",
      outcome: "failure",
      bytes: 4096,
    });

    expect(
      await seriesOf("platform.import.total", "platform.import.outcome"),
    ).toEqual(
      new Map([
        ["success", 1],
        ["failure", 1],
      ]),
    );
    expect(
      await seriesOf("platform.import.bytes", "platform.import.surface"),
    ).toEqual(new Map([["ui", 2048]]));
  });

  /** TEST_SCENARIO: a Local Skill leaves no state behind, so the event is the
   *  only trace it ever existed — the origin must stay on the counter. */
  it("counts skill installs by action and origin", async () => {
    start();

    emit({
      type: EventType.AgentSkillChanged,
      action: "installed",
      agentId: "agent-1",
      actorSub: "user-1",
      surface: "ui",
      origin: "local",
      name: "my-skill",
    });
    emit({
      type: EventType.AgentSkillChanged,
      action: "uninstalled",
      agentId: "agent-1",
      actorSub: "user-1",
      surface: "ui",
      origin: "source",
      name: "my-skill",
    });

    expect(
      await seriesOf("platform.skill.change.total", "platform.skill.origin"),
    ).toEqual(
      new Map([
        ["local", 1],
        ["source", 1],
      ]),
    );
  });

  /** TEST_SCENARIO: attachments answer whether a relay earns its keep, so each
   *  relay keeps its own series and an unrecognized one folds. */
  it("counts relay attachments by relay kind", async () => {
    start();

    for (const relay of ["terminal", "ssh", "something-else"])
      emit({
        type: EventType.AgentRelayAttached,
        agentId: "agent-1",
        actorSub: "user-1",
        surface: "ui",
        relay,
      });

    expect(
      await seriesOf("platform.relay.attach.total", "platform.relay.kind"),
    ).toEqual(
      new Map([
        ["terminal", 1],
        ["ssh", 1],
        ["other", 1],
      ]),
    );
  });

  /** TEST_SCENARIO: delegation and the way in are plain volumes — one has no
   *  bounded dimension worth carrying, the other only its choice. */
  it("counts invocation spawns and entry-point choices", async () => {
    start();

    emit({
      type: EventType.InvocationSpawned,
      targetAgentId: "agent-2",
      driverAgentId: "agent-1",
      ownerSub: "user-1",
    });
    emit({
      type: EventType.EntryPointChosen,
      actorSub: "user-1",
      choice: "sandbox",
    });

    expect(await points("platform.invocation.spawn.total")).toEqual([
      { attributes: {}, value: 1 },
    ]);
    expect(
      await seriesOf(
        "platform.entry_point.choice.total",
        "platform.entry_point.choice",
      ),
    ).toEqual(new Map([["sandbox", 1]]));
  });

  /** TEST_SCENARIO: an approval closes in one of a fixed set of ways, and an
   *  expiry must stay apart from a decision so unanswered requests are visible. */
  it("counts approval resolutions by how they closed", async () => {
    start();

    for (const resolution of ["allow_once", "deny", "expired"] as const)
      emit({
        type: EventType.ApprovalResolved,
        approvalId: `approval-${resolution}`,
        agentId: "agent-1",
        ownerSub: "user-1",
        resolution,
      });

    expect(
      await seriesOf(
        "platform.approval.resolution.total",
        "platform.approval.resolution",
      ),
    ).toEqual(
      new Map([
        ["allow_once", 1],
        ["deny", 1],
        ["expired", 1],
      ]),
    );
  });

  /** TEST_SCENARIO: knowledge base sharing and skill sets had no counter, so
   *  their use was only guessable from request volume. */
  it("counts knowledge base share publishes and skill set changes", async () => {
    start();

    emit({
      type: EventType.KbSharePublished,
      agentId: "agent-1",
      ownerSub: "user-1",
    });
    emit({
      type: EventType.KbSharePublishFailed,
      agentId: "agent-1",
      ownerSub: "user-1",
      reason: "free-form text that must not become a dimension",
    });
    emit({
      type: EventType.SkillSetSaved,
      actorSub: "user-1",
      surface: "ui",
      skillCount: 2,
    });
    emit({
      type: EventType.SkillSetDeleted,
      actorSub: "user-1",
      surface: "ui",
    });

    expect(
      await seriesOf(
        "platform.kb_share.publish.total",
        "platform.kb_share.outcome",
      ),
    ).toEqual(
      new Map([
        ["success", 1],
        ["failure", 1],
      ]),
    );
    expect(
      await seriesOf(
        "platform.skill_set.change.total",
        "platform.skill_set.action",
      ),
    ).toEqual(
      new Map([
        ["saved", 1],
        ["deleted", 1],
      ]),
    );
  });

  /** TEST_SCENARIO: state gauges describe the whole install, so only the
   *  replica holding the role reports them, and it stops when the role goes. */
  it("reports state gauges only while holding the role", async () => {
    start();

    expect(await points("platform.skill_sets")).toEqual([]);

    await usageMetrics.stateGaugesRole.onAcquired();

    expect(await points("platform.skill_sets")).toEqual([
      { attributes: {}, value: 4 },
    ]);
    expect(await points("platform.knowledge_bases.shared")).toEqual([
      { attributes: {}, value: 3 },
    ]);

    await usageMetrics.stateGaugesRole.onLost();

    const { resourceMetrics } = await reader.collect();
    const skillSets = resourceMetrics.scopeMetrics
      .flatMap((scope) => scope.metrics)
      .find((m) => m.descriptor.name === "platform.skill_sets");
    expect(skillSets?.dataPoints ?? []).toEqual([]);
  });

  /** TEST_SCENARIO: every label set is closed, so every series is reported
   *  with an explicit zero rather than vanishing when its count drops. */
  it("reports every agent and workspace series, zeros included", async () => {
    start(["claude-code"]);
    await usageMetrics.stateGaugesRole.onAcquired();

    const agents = await points("platform.agents");
    const count = (harness: string, origin: string) =>
      agents.find(
        (p) =>
          p.attributes["platform.agent.harness"] === harness &&
          p.attributes["platform.agent.origin"] === origin,
      )?.value;

    expect(agents).toHaveLength(4 * 3);
    expect(count("claude-code", "starter_kit")).toBe(1);
    expect(count("unknown", "blank")).toBe(1);
    expect(count("unknown", "invocation")).toBe(1);
    expect(count("claude-code", "blank")).toBe(0);
    expect(
      await seriesOf(
        "platform.slack.workspaces",
        "platform.slack.credential_state",
      ),
    ).toEqual(
      new Map([
        ["active", 2],
        ["rejected", 0],
      ]),
    );
  });

  /** TEST_SCENARIO: the whole set is identity-free by construction, so both
   *  the measurements and their attribute keys are pinned here — a new counter
   *  fed from these events, or a dimension naming a person, an agent or
   *  anything user-authored, must fail the build rather than reach the
   *  telemetry store unnoticed. */
  it("exports only the measurements and attribute keys declared here", async () => {
    start();
    await usageMetrics.stateGaugesRole.onAcquired();

    emit({
      type: EventType.SessionTurnRelayed,
      agentId: "agent-1",
      actorSub: "user-1",
      surface: "ui",
    });
    emit({
      type: EventType.UserAuthenticated,
      userSub: "user-1",
      surface: "ui",
      isCore: true,
    });
    emit({
      type: EventType.ScheduleFired,
      scheduleId: "sched-1",
      agentId: "agent-1",
      ownerSub: "user-1",
      mode: "fresh",
      outcome: "success",
    });
    emit({
      type: EventType.ConnectionCreated,
      actorSub: "user-1",
      connectionKey: "conn-1",
      templateId: "github",
      kind: "oauth_app",
    });
    emit({
      type: EventType.FilesImported,
      actorSub: "user-1",
      agentId: "agent-1",
      surface: "ui",
      outcome: "success",
      bytes: 1,
    });
    emit({
      type: EventType.AgentSkillChanged,
      action: "installed",
      agentId: "agent-1",
      actorSub: "user-1",
      surface: "ui",
      origin: "source",
      name: "my-skill",
      source: "https://example.invalid/skills.git",
    });
    emit({
      type: EventType.AgentRelayAttached,
      agentId: "agent-1",
      actorSub: "user-1",
      surface: "ui",
      relay: "acp",
    });
    emit({
      type: EventType.InvocationSpawned,
      targetAgentId: "agent-2",
      driverAgentId: "agent-1",
      ownerSub: "user-1",
    });
    emit({
      type: EventType.EntryPointChosen,
      actorSub: "user-1",
      choice: "sandbox",
    });
    emit({
      type: EventType.ApprovalResolved,
      approvalId: "approval-1",
      agentId: "agent-1",
      ownerSub: "user-1",
      resolution: "allow",
    });
    emit({
      type: EventType.KbSharePublished,
      agentId: "agent-1",
      ownerSub: "user-1",
    });
    emit({
      type: EventType.SkillSetSaved,
      actorSub: "user-1",
      surface: "ui",
      skillCount: 1,
    });

    const declared: Record<string, string[]> = {
      "platform.turn.total": ["platform.turn.harness", "platform.turn.surface"],
      "platform.actor.active_day.total": ["platform.actor.surface"],
      "platform.schedule.fire.total": [
        "platform.schedule.harness",
        "platform.schedule.mode",
        "platform.schedule.outcome",
      ],
      "platform.connection.change.total": [
        "platform.connection.action",
        "platform.connection.kind",
        "platform.connection.provider",
      ],
      "platform.import.total": [
        "platform.import.outcome",
        "platform.import.surface",
      ],
      "platform.import.bytes": ["platform.import.surface"],
      "platform.skill.change.total": [
        "platform.skill.action",
        "platform.skill.origin",
      ],
      "platform.relay.attach.total": [
        "platform.relay.kind",
        "platform.relay.surface",
      ],
      "platform.invocation.spawn.total": [],
      "platform.entry_point.choice.total": ["platform.entry_point.choice"],
      "platform.approval.resolution.total": ["platform.approval.resolution"],
      "platform.kb_share.publish.total": ["platform.kb_share.outcome"],
      "platform.skill_set.change.total": ["platform.skill_set.action"],
      "platform.agents": ["platform.agent.harness", "platform.agent.origin"],
      "platform.slack.workspaces": ["platform.slack.credential_state"],
      "platform.knowledge_bases.shared": [],
      "platform.skill_sets": [],
    };

    expect(await exportedNames()).toEqual(Object.keys(declared).sort());

    for (const [name, keys] of Object.entries(declared)) {
      const seen = new Set((await attributeKeys(name)).map((k) => k.join()));
      expect([...seen], name).toEqual([keys.join()]);
    }
  });
});
