/** TEST_OVERVIEW: the usage counters that let the telemetry store answer what
 *  the platform is used for — one series per measurement, fed from the bus,
 *  carrying no identifier of the person or agent behind the interaction. */
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emit, EventType } from "../../events.js";
import { composeUsageMetricsModule } from "../../modules/usage-metrics/index.js";
import type { AgentTemplate } from "../../modules/usage-metrics/index.js";

const DAY_ONE = Date.parse("2026-09-14T09:00:00Z");
const DAY_TWO = Date.parse("2026-09-15T01:00:00Z");

describe("usage metrics", () => {
  let reader: PeriodicExportingMetricReader;
  let meterProvider: MeterProvider;
  let usageMetrics: { start(): void; stop(): void };
  let clock = DAY_ONE;
  let templates = new Map<string, AgentTemplate>();

  function start(knownTemplates: string[] = ["claude-code", "codex"]): void {
    usageMetrics = composeUsageMetricsModule({
      meter: meterProvider.getMeter("test"),
      templateOf: (agentId) =>
        templates.get(agentId) ?? { agent: "unresolved" },
      knownTemplates: new Set(knownTemplates),
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
    templates = new Map<string, AgentTemplate>([
      ["agent-1", { agent: "resolved", templateId: "claude-code" }],
    ]);
    reader = new PeriodicExportingMetricReader({
      exporter: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
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

  /** TEST_SCENARIO: the template answers which kind of agent the traffic went
   *  to. Each way of not knowing it is its own bucket: an agent built from a
   *  raw image has none, an agent the cache cannot resolve is unknown, and a
   *  template this install does not carry folds to other — so cardinality
   *  stays bounded by the install's own catalog. */
  it("labels each turn with a bounded template", async () => {
    templates.set("agent-image", { agent: "resolved" });
    templates.set("agent-foreign", {
      agent: "resolved",
      templateId: "retired-template",
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

    expect(
      await seriesOf("platform.turn.total", "platform.turn.template"),
    ).toEqual(
      new Map([
        ["claude-code", 1],
        ["none", 1],
        ["other", 1],
        ["unknown", 1],
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
  it("counts schedule fires with their mode, outcome and template", async () => {
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
          "platform.schedule.template": "claude-code",
        },
        value: 1,
      },
      {
        attributes: {
          "platform.schedule.mode": "continuous",
          "platform.schedule.outcome": "failure",
          "platform.schedule.template": "claude-code",
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

  /** TEST_SCENARIO: experiment transitions the platform drives itself — a sweep
   *  reaping an idle experiment — are not someone using the feature, so only
   *  the ones a person drove count. */
  it("counts only person-driven experiment transitions", async () => {
    start();

    emit({
      type: EventType.ExperimentChanged,
      experimentId: "exp-1",
      agentId: "agent-1",
      ownerSub: "user-1",
      action: "started",
      actorSub: "user-1",
      surface: "ui",
    });
    emit({
      type: EventType.ExperimentChanged,
      experimentId: "exp-1",
      agentId: "agent-1",
      ownerSub: "user-1",
      action: "stopped",
    });
    emit({
      type: EventType.ExperimentChanged,
      experimentId: "exp-1",
      agentId: "agent-1",
      ownerSub: "user-1",
    });

    expect(
      await seriesOf(
        "platform.experiment.change.total",
        "platform.experiment.action",
      ),
    ).toEqual(new Map([["started", 1]]));
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

  /** TEST_SCENARIO: the whole set is identity-free by construction, so both
   *  the measurements and their attribute keys are pinned here — a new counter
   *  fed from these events, or a dimension naming a person, an agent or
   *  anything user-authored, must fail the build rather than reach the
   *  telemetry store unnoticed. */
  it("exports only the measurements and attribute keys declared here", async () => {
    start();

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
      type: EventType.ExperimentChanged,
      experimentId: "exp-1",
      agentId: "agent-1",
      ownerSub: "user-1",
      action: "started",
      actorSub: "user-1",
      surface: "ui",
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

    const declared: Record<string, string[]> = {
      "platform.turn.total": [
        "platform.turn.surface",
        "platform.turn.template",
      ],
      "platform.actor.active_day.total": ["platform.actor.surface"],
      "platform.schedule.fire.total": [
        "platform.schedule.mode",
        "platform.schedule.outcome",
        "platform.schedule.template",
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
      "platform.experiment.change.total": ["platform.experiment.action"],
      "platform.invocation.spawn.total": [],
      "platform.entry_point.choice.total": ["platform.entry_point.choice"],
    };

    expect(await exportedNames()).toEqual(Object.keys(declared).sort());

    for (const [name, keys] of Object.entries(declared)) {
      const seen = await attributeKeys(name);
      expect(seen, name).toHaveLength(1);
      expect(seen[0], name).toEqual(keys);
    }
  });
});
