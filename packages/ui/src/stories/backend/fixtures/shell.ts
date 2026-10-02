import { ChannelType } from "api-server-api";

import { at, type PlatformOutput } from "../platform";
import { ago, IDS, NOW, whenPopulated } from "../scenario";
import { NotFound } from "../trpc-server";
import { AGENTS } from "./agents";

// Session ids the agent-runtime fixtures (agent-fixtures.ts) serve, so feed
// cards, spend rows and approvals point at sessions that actually exist.
const SESSIONS = {
  kbIngest: "5d1a7e20-0001-4b0c-9a55-2f4e6c8d0a11",
  kbCredentials: "5d1a7e20-0002-4b0c-9a55-2f4e6c8d0a12",
  slackPodStuck: "9b3c4d10-0001-4e2f-8a1b-6c7d8e9f0a21",
  slackRotate: "9b3c4d10-0002-4e2f-8a1b-6c7d8e9f0a22",
} as const;

const HOUR = 60;
const DAY = 24 * HOUR;
/** `apiServer.approvalHoldSeconds` default (1800s). */
const APPROVAL_HOLD_MIN = 30;
const later = (iso: string, minutes: number) =>
  new Date(Date.parse(iso) + minutes * 60_000).toISOString();

// ---------------------------------------------------------------------------
// Install config
// ---------------------------------------------------------------------------

type Template = PlatformOutput<"templates.list">[number];

function template(over: Partial<Template> & Pick<Template, "id">): Template {
  return {
    name: over.id,
    image: `quay.io/dam-agents/${over.id}:latest`,
    description: undefined,
    category: "harness",
    harness: undefined,
    providers: undefined,
    tags: undefined,
    docsUrl: undefined,
    releaseNotesUrl: undefined,
    setupNote: undefined,
    experimental: false,
    size: { cpu: undefined, memory: undefined },
    ...over,
  };
}

/** `harnessTemplates` from helm/values.yaml, as `templates.list` serves them. */
const TEMPLATES: Template[] = [
  template({
    id: "claude-code",
    name: "Claude Code",
    description: "Default Claude Code agent",
    harness: "claude-code",
    providers: ["ibm-litellm", "anthropic"],
    tags: ["Anthropic"],
    releaseNotesUrl: "https://code.claude.com/docs/en/whats-new",
  }),
  template({
    id: "codex",
    name: "Codex",
    description: "OpenAI Codex coding agent",
    harness: "codex",
    providers: ["ibm-litellm", "openai"],
    tags: ["OpenAI"],
    releaseNotesUrl: "https://github.com/openai/codex/releases",
  }),
  template({
    id: "pi-agent",
    name: "PI Agent",
    description: "Pi coding agent with multi-LLM support",
    harness: "pi",
    providers: ["ibm-litellm", "anthropic", "openai"],
    tags: ["Any provider"],
  }),
  template({
    id: "bob",
    name: "IBM Bob",
    description: "Bob shell agent",
    harness: "bob",
    providers: ["ibm-litellm", "bob"],
    tags: ["Anthropic", "Mistral", "Granite"],
    releaseNotesUrl: "https://bob.ibm.com/docs/shell/changelog",
    size: { cpu: "2", memory: "4Gi" },
  }),
];

/** Every flag off: the api-server's default for a user who never toggled one. */
export const FLAGS: PlatformOutput<"features.flags"> = {
  "advanced-connections": false,
  "vm-sandboxes": false,
  "session-costs": false,
  "interactive-artifacts": false,
  "agent-telemetry": false,
  "agent-avatars": false,
};

// ---------------------------------------------------------------------------
// Compute budget
// ---------------------------------------------------------------------------

const GI = 1024 ** 3;

/** Size of a running agent in milli-CPU and bytes (agents are "2" / "2Gi"). */
function running() {
  const agents = whenPopulated(AGENTS, []).filter((a) => a.state === "running");
  const cpu = agents.reduce(
    (sum, a) => sum + Number(a.size.cpu ?? 0) * 1000,
    0,
  );
  const mem = agents.reduce(
    (sum, a) => sum + Number.parseFloat(a.size.memory ?? "0") * GI,
    0,
  );
  return { cpu, mem };
}

// ---------------------------------------------------------------------------
// Attention feed + approvals
// ---------------------------------------------------------------------------

type AttentionItem = PlatformOutput<"attention.listForOwner">["items"][number];

function attentionItem(
  over: Partial<AttentionItem> &
    Pick<AttentionItem, "agentId" | "sessionId" | "createdAt">,
): AttentionItem {
  return {
    mode: "chat" as AttentionItem["mode"],
    type: "regular",
    title: null,
    scheduleId: null,
    activityAt: over.createdAt,
    seenAt: null,
    working: false,
    ...over,
  };
}

const ATTENTION: AttentionItem[] = [
  attentionItem({
    agentId: IDS.codingAgent,
    sessionId: IDS.session1,
    title: "Fix one-cent rounding error on discounted carts",
    createdAt: ago(38),
    activityAt: ago(12),
    seenAt: ago(30),
  }),
  attentionItem({
    agentId: IDS.slackAgent,
    sessionId: SESSIONS.slackPodStuck,
    type: "channel_slack",
    title: "Agent pod stuck in ContainerCreating",
    createdAt: ago(45),
    activityAt: ago(40),
  }),
  attentionItem({
    agentId: IDS.kbAgent,
    sessionId: SESSIONS.kbIngest,
    title: "Ingest the new egress-rules architecture page",
    createdAt: ago(3 * HOUR),
    activityAt: ago(3 * HOUR - 6),
    seenAt: ago(3 * HOUR - 6),
  }),
  attentionItem({
    agentId: IDS.codingAgent,
    sessionId: IDS.session2,
    title: "Add idempotency keys to the refund endpoint",
    createdAt: ago(5 * HOUR),
    activityAt: ago(4 * HOUR + 20),
    seenAt: ago(4 * HOUR + 20),
  }),
  attentionItem({
    agentId: IDS.slackAgent,
    sessionId: SESSIONS.slackRotate,
    type: "channel_slack",
    title: "How do I rotate a GitHub connection token?",
    createdAt: ago(22 * HOUR),
    activityAt: ago(22 * HOUR - 4),
  }),
  attentionItem({
    agentId: IDS.codingAgent,
    sessionId: IDS.session3,
    title: "Why is the webhook retry test flaky?",
    createdAt: ago(26 * HOUR),
    activityAt: ago(25 * HOUR + 30),
    seenAt: ago(25 * HOUR + 30),
  }),
  attentionItem({
    agentId: IDS.kbAgent,
    sessionId: SESSIONS.kbCredentials,
    title: "How does credential injection work?",
    createdAt: ago(2 * DAY),
    activityAt: ago(2 * DAY - 3),
    seenAt: ago(2 * DAY - 3),
  }),
];

type Approval = PlatformOutput<"approvals.listForOwner">[number];

function approval(
  over: Partial<Approval> &
    Pick<Approval, "id" | "agentId" | "payload" | "createdAt">,
): Approval {
  return {
    type: over.payload.kind,
    sessionId: null,
    expiresAt: later(over.createdAt, APPROVAL_HOLD_MIN),
    resolvedAt: null,
    verdict: null,
    status: "pending",
    ...over,
  };
}

const APPROVALS: Approval[] = [
  approval({
    id: "apr-6f2d1c80-0003",
    agentId: IDS.slackAgent,
    sessionId: SESSIONS.slackPodStuck,
    createdAt: ago(4),
    payload: {
      kind: "acp_native",
      toolName: "kubectl describe pod checkout-service-0 -n platform-agents",
      rpcId: 41,
      options: [
        { optionId: "allow_once", kind: "allow_once" },
        { optionId: "allow_always", kind: "allow_always" },
        { optionId: "reject_once", kind: "reject_once" },
        { optionId: "reject_always", kind: "reject_always" },
      ],
    },
  }),
  approval({
    id: "apr-6f2d1c80-0002",
    agentId: IDS.codingAgent,
    sessionId: IDS.session1,
    createdAt: ago(9),
    payload: {
      kind: "ext_authz",
      host: "api.stripe.com",
      method: "GET",
      path: "/v1/coupons",
    },
  }),
  approval({
    id: "apr-6f2d1c80-0001",
    agentId: IDS.codingAgent,
    sessionId: IDS.session2,
    createdAt: ago(4 * HOUR + 50),
    resolvedAt: ago(4 * HOUR + 48),
    verdict: "allow",
    status: "resolved",
    payload: {
      kind: "ext_authz",
      host: "registry.npmjs.org",
      method: "GET",
      path: "/uuid",
    },
  }),
  approval({
    id: "apr-6f2d1c80-0000",
    agentId: IDS.kbAgent,
    sessionId: SESSIONS.kbIngest,
    createdAt: ago(3 * HOUR),
    resolvedAt: ago(3 * HOUR - 1),
    verdict: "allow_once",
    status: "resolved",
    payload: {
      kind: "ext_authz",
      host: "raw.githubusercontent.com",
      method: "GET",
      path: "/acme/platform/main/docs/architecture/egress-rules.md",
    },
  }),
];

type ApprovalListOpts = { limit?: number; status?: Approval["status"] };

function listApprovals(
  agentId: string | undefined,
  input: ApprovalListOpts | void,
) {
  const opts: ApprovalListOpts = input || {};
  return whenPopulated(APPROVALS, [])
    .filter((a) => agentId === undefined || a.agentId === agentId)
    .filter((a) => opts.status === undefined || a.status === opts.status)
    .slice(0, opts.limit ?? 500);
}

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------

type Schedule = PlatformOutput<"schedules.listForOwner">[number];

const SCHEDULES: Schedule[] = [
  {
    id: "sched-4a7e21b0",
    name: "Nightly docs sync",
    agentId: IDS.kbAgent,
    type: "rrule",
    task: "Pull the latest docs/architecture and ADR changes from main and update the wiki pages that changed.",
    precheck: null,
    enabled: true,
    sessionMode: "fresh",
    createdBy: "user",
    status: {
      lastRun: ago(10 * HOUR),
      nextRun: later(ago(10 * HOUR), DAY),
      lastResult: "success",
    },
    cron: null,
    rrule: "FREQ=DAILY;BYHOUR=2;BYMINUTE=0;BYSECOND=0",
    timezone: "America/New_York",
    quietHours: [],
  },
  {
    id: "sched-4a7e21b1",
    name: "Dependency audit",
    agentId: IDS.codingAgent,
    type: "rrule",
    task: "Run pnpm audit, open a PR bumping any package with a high or critical advisory, and summarise what changed.",
    precheck: null,
    enabled: true,
    sessionMode: "fresh",
    createdBy: "user",
    status: {
      lastRun: ago(3 * DAY + 5 * HOUR),
      nextRun: later(ago(3 * DAY + 5 * HOUR), 7 * DAY),
      lastResult: "success",
    },
    cron: null,
    rrule: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0;BYSECOND=0",
    timezone: "America/New_York",
    quietHours: [],
  },
  {
    id: "sched-4a7e21b2",
    name: "Unanswered threads sweep",
    agentId: IDS.slackAgent,
    type: "rrule",
    task: "Look for #help-platform threads from the last hour with no reply and answer the ones you can.",
    precheck: null,
    enabled: true,
    sessionMode: "continuous",
    createdBy: "agent",
    status: {
      lastRun: ago(25),
      nextRun: later(ago(25), HOUR),
      lastResult: "success",
    },
    cron: null,
    rrule: "FREQ=HOURLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR",
    timezone: "America/New_York",
    quietHours: [{ startTime: "19:00", endTime: "08:00", enabled: true }],
  },
  {
    id: "sched-4a7e21b3",
    name: "Warehouse row-count check",
    agentId: IDS.hibernatedAgent,
    type: "cron",
    task: "Compare yesterday's row counts in the orders and events tables against the 7-day average and flag anything off by more than 20%.",
    precheck: null,
    enabled: false,
    sessionMode: "fresh",
    createdBy: "user",
    status: {
      lastRun: ago(9 * DAY),
      lastResult: "success",
    },
    cron: "30 6 * * *",
    rrule: null,
    timezone: null,
    quietHours: [],
  },
];

// ---------------------------------------------------------------------------
// Spend: one daily ledger per agent+model, aggregated per requested window,
// so every period, the breakdown and the overview agree with each other.
// ---------------------------------------------------------------------------

interface ModelPrice {
  /** Share of a dollar spent, per token kind, used to back out token counts. */
  inPerM: number;
  outPerM: number;
  cacheReadPerM: number;
  cacheWritePerM: number;
  /** Average cost of one call, to back out call counts. */
  perCall: number;
  /** Average model time per call. */
  msPerCall: number;
}

const PRICES: Record<string, ModelPrice> = {
  "claude-sonnet-4-5": {
    inPerM: 3,
    outPerM: 15,
    cacheReadPerM: 0.3,
    cacheWritePerM: 3.75,
    perCall: 0.042,
    msPerCall: 7_400,
  },
  "claude-haiku-4-5": {
    inPerM: 1,
    outPerM: 5,
    cacheReadPerM: 0.1,
    cacheWritePerM: 1.25,
    perCall: 0.006,
    msPerCall: 2_100,
  },
};

interface Stream {
  agentId: string;
  model: string;
  /** Typical weekday spend in USD. */
  daily: number;
  /** Days back the stream starts (agent creation). */
  since: number;
}

// Only harnesses that export per-call telemetry (Claude Code, per the
// `telemetry` flag in harnessTemplates) show up in spend, so triage-bot
// (Codex) and data-pipeline (PI Agent) have none.
const STREAMS: Stream[] = [
  {
    agentId: IDS.codingAgent,
    model: "claude-sonnet-4-5",
    daily: 5.2,
    since: 12,
  },
  {
    agentId: IDS.codingAgent,
    model: "claude-haiku-4-5",
    daily: 0.24,
    since: 12,
  },
  { agentId: IDS.kbAgent, model: "claude-sonnet-4-5", daily: 1.1, since: 30 },
  { agentId: IDS.kbAgent, model: "claude-haiku-4-5", daily: 0.09, since: 30 },
];

/** Deterministic 0.55–1.45 wobble so days differ but every run matches. */
function wobble(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return 0.55 + (x - Math.floor(x)) * 0.9;
}

interface LedgerRow {
  day: number; // days back from NOW (0 = today)
  date: Date;
  agentId: string;
  model: string;
  costUsd: number;
}

const LEDGER: LedgerRow[] = STREAMS.flatMap((stream, s) => {
  const rows: LedgerRow[] = [];
  for (let day = stream.since; day >= 0; day--) {
    const date = new Date(NOW - day * DAY * 60_000);
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    const scale = (weekend ? 0.15 : 1) * wobble(s * 1000 + day);
    // Today is only partly through.
    const partial = day === 0 ? 0.6 : 1;
    rows.push({
      day,
      date,
      agentId: stream.agentId,
      model: stream.model,
      costUsd: Math.round(stream.daily * scale * partial * 10_000) / 10_000,
    });
  }
  return rows;
});

function inWindow(from: string, to: string, agentId?: string) {
  const lo = Date.parse(from);
  const hi = Date.parse(to);
  return whenPopulated(LEDGER, []).filter(
    (r) =>
      r.date.getTime() >= lo &&
      r.date.getTime() <= hi &&
      (agentId === undefined || r.agentId === agentId),
  );
}

type ModelSpend = PlatformOutput<"metrics.spendBreakdown">["byModel"][number];

function modelSpend(model: string, costUsd: number): ModelSpend {
  const p = PRICES[model] ?? PRICES["claude-sonnet-4-5"]!;
  // Split a dollar across token kinds the way an agentic loop spends it:
  // mostly cache reads and output, some fresh input, a little cache writing.
  const share = { in: 0.18, out: 0.46, cacheRead: 0.26, cacheWrite: 0.1 };
  const tokens = (portion: number, perM: number) =>
    perM > 0 ? Math.round(((costUsd * portion) / perM) * 1_000_000) : 0;
  const calls = Math.max(costUsd > 0 ? 1 : 0, Math.round(costUsd / p.perCall));
  return {
    model,
    calls,
    inputTokens: tokens(share.in, p.inPerM),
    outputTokens: tokens(share.out, p.outPerM),
    cacheReadTokens: tokens(share.cacheRead, p.cacheReadPerM),
    cacheCreationTokens: tokens(share.cacheWrite, p.cacheWritePerM),
    costUsd: round(costUsd),
    durationMs: calls * p.msPerCall,
  };
}

const round = (n: number) => Math.round(n * 10_000) / 10_000;

function sumBy<K extends string>(rows: LedgerRow[], key: (r: LedgerRow) => K) {
  const out = new Map<K, number>();
  for (const r of rows) out.set(key(r), (out.get(key(r)) ?? 0) + r.costUsd);
  return [...out].sort((a, b) => b[1] - a[1]);
}

function dayKey(date: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD, matching ClickHouse's toDate().
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(date);
}

const agentName = (id: string) => AGENTS.find((a) => a.id === id)?.name ?? id;

// Per-session runtime rows for `metrics.overview`, one per session the
// agent-runtime fixtures serve; costs roughly track each session's run time.
type SessionRuntime =
  PlatformOutput<"metrics.overview">["runtimeBySession"][number];

function sessionRuntime(
  agentId: string,
  sessionId: string,
  model: string,
  costUsd: number,
  firstAt: string,
  lastAt: string,
): SessionRuntime {
  const m = modelSpend(model, costUsd);
  return {
    sessionId,
    agentId,
    calls: m.calls,
    totalDurationMs: m.durationMs,
    inputTokens: m.inputTokens,
    outputTokens: m.outputTokens,
    cacheReadTokens: m.cacheReadTokens,
    cacheCreationTokens: m.cacheCreationTokens,
    costUsd: m.costUsd,
    firstAt,
    lastAt,
  };
}

export const RUNTIMES: { model: string; row: SessionRuntime }[] = [
  {
    model: "claude-sonnet-4-5",
    row: sessionRuntime(
      IDS.codingAgent,
      IDS.session1,
      "claude-sonnet-4-5",
      1.84,
      ago(38),
      ago(12),
    ),
  },
  {
    model: "claude-sonnet-4-5",
    row: sessionRuntime(
      IDS.codingAgent,
      IDS.session2,
      "claude-sonnet-4-5",
      3.12,
      ago(5 * HOUR),
      ago(4 * HOUR + 20),
    ),
  },
  {
    model: "claude-sonnet-4-5",
    row: sessionRuntime(
      IDS.codingAgent,
      IDS.session3,
      "claude-sonnet-4-5",
      0.97,
      ago(26 * HOUR),
      ago(25 * HOUR + 30),
    ),
  },
  {
    model: "claude-sonnet-4-5",
    row: sessionRuntime(
      IDS.kbAgent,
      SESSIONS.kbIngest,
      "claude-sonnet-4-5",
      1.06,
      ago(3 * HOUR),
      ago(3 * HOUR - 6),
    ),
  },
  {
    model: "claude-sonnet-4-5",
    row: sessionRuntime(
      IDS.kbAgent,
      SESSIONS.kbCredentials,
      "claude-sonnet-4-5",
      0.19,
      ago(2 * DAY),
      ago(2 * DAY - 3),
    ),
  },
];

type CallContext = PlatformOutput<"metrics.overview">["contextPerCall"][number];

/** Individual calls spread across a session, context growing turn by turn. */
function callsFor({ model, row }: (typeof RUNTIMES)[number]): CallContext[] {
  const p = PRICES[model]!;
  const first = Date.parse(row.firstAt);
  const span = Math.max(1, Date.parse(row.lastAt) - first);
  const perCall = row.costUsd / row.calls;
  return Array.from({ length: row.calls }, (_, i) => {
    const context = 14_000 + i * 2_600;
    const output = Math.round(380 + wobble(i + row.calls) * 900);
    return {
      at: new Date(
        first + (span * i) / Math.max(1, row.calls - 1),
      ).toISOString(),
      requestId: `req_${row.sessionId.slice(0, 8)}_${String(i).padStart(3, "0")}`,
      agentId: row.agentId,
      model,
      inputTokens: 1_200 + Math.round(wobble(i) * 2_400),
      cacheReadTokens: context - 1_800,
      cacheCreationTokens: 1_800,
      outputTokens: output,
      contextTokens: context,
      costUsd: round(perCall * wobble(i * 7)),
      durationMs: Math.round(p.msPerCall * wobble(i * 3)),
    };
  }).reverse();
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

const APPLIED = { outcome: "applied" as const, rule: null };

export const shellEntries = [
  at("channels.available", () => ({ [ChannelType.Slack]: true })),
  at("features.flags", () => FLAGS),
  at("features.setFlag", ({ feature, enabled }) => ({
    ...FLAGS,
    [feature]: enabled,
  })),
  at("features.install", () => ({ virtualization: false })),
  at("links.all", () => ({ computeRequest: null })),
  at("templates.list", () => TEMPLATES),
  at("templates.get", ({ id }) => {
    const found = TEMPLATES.find((t) => t.id === id);
    if (!found) throw new NotFound();
    return found;
  }),
  at("satellites.list", () => []),
  // Void mutations: the typed `at` resolves a void output to `never`.
  at("usage.entryPointChosen", (() => undefined) as never),

  at("budgets.reserved", () => {
    const { cpu, mem } = running();
    return {
      // `controller.userBudgets` defaults: 8 CPU / 16Gi.
      cpu: { reservedMilli: cpu, ceilingMilli: 8_000 },
      memory: { reservedBytes: mem, ceilingBytes: 16 * GI },
      // Slot = `templateDefaults.resources.limits` (1 CPU / 2Gi).
      slot: { cpuMilli: 1_000, memoryBytes: 2 * GI },
    };
  }),

  at("attention.listForOwner", () => ({
    items: whenPopulated(ATTENTION, []),
    dismissed: [],
  })),
  at("attention.dismiss", (() => undefined) as never),

  at("approvals.listForOwner", (input) => listApprovals(undefined, input)),
  at("approvals.listForInstance", ({ agentId, ...opts }) =>
    listApprovals(agentId, opts),
  ),
  at("approvals.approveOnce", () => APPLIED),
  at("approvals.approvePermanent", () => APPLIED),
  at("approvals.approveHost", () => APPLIED),
  at("approvals.denyForever", () => APPLIED),
  at("approvals.dismiss", () => APPLIED),

  at("schedules.listForOwner", (input) =>
    whenPopulated(SCHEDULES, []).slice(0, input?.limit ?? 200),
  ),
  at("schedules.list", ({ agentId }) =>
    whenPopulated(SCHEDULES, []).filter((s) => s.agentId === agentId),
  ),
  at("schedules.get", ({ id }) => {
    const found = whenPopulated(SCHEDULES, []).find((s) => s.id === id);
    if (!found) throw new NotFound();
    return found;
  }),

  at("metrics.spendBreakdown", ({ from, to, agentId, timeZone }) => {
    const rows = inWindow(from, to, agentId);
    return {
      byModel: sumBy(rows, (r) => r.model).map(([model, cost]) =>
        modelSpend(model, cost),
      ),
      byAgent: sumBy(rows, (r) => r.agentId).map(([id, cost]) => ({
        agentId: id,
        agentName: agentName(id),
        costUsd: round(cost),
      })),
      byDay: sumBy(rows, (r) => dayKey(r.date, timeZone))
        .map(([day, cost]) => ({ day, costUsd: round(cost) }))
        .sort((a, b) => a.day.localeCompare(b.day)),
      // Empty unless the `session-costs` flag is on, which it isn't.
      bySessionType: [],
    };
  }),

  at("metrics.overview", ({ agentId, sessionId, ...query }) => {
    // `sinceHours` and `limit` are z.coerce'd, so their input type is unknown.
    const hours = Number(query.sinceHours ?? 24 * 30);
    const limit = Number(query.limit ?? 100);
    const from = new Date(NOW - hours * HOUR * 60_000).toISOString();
    const to = new Date(NOW).toISOString();
    const rows = inWindow(from, to, agentId);
    const runtimes = whenPopulated(RUNTIMES, []).filter(
      (r) =>
        (agentId === undefined || r.row.agentId === agentId) &&
        (sessionId === undefined || r.row.sessionId === sessionId) &&
        Date.parse(r.row.lastAt) >= Date.parse(from),
    );
    return {
      tokenSpendByModel: sumBy(rows, (r) => r.model).map(([model, cost]) =>
        modelSpend(model, cost),
      ),
      runtimeBySession: runtimes
        .map((r) => r.row)
        .sort((a, b) => b.lastAt.localeCompare(a.lastAt))
        .slice(0, limit),
      contextPerCall: runtimes
        .flatMap(callsFor)
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, limit),
    };
  }),
];
