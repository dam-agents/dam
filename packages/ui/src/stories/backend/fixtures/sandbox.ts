import type {
  LibraryArtifact,
  LocalSkill,
  Skill,
  SkillPublishRecord,
  SkillRef,
  SkillSet,
  SkillSource,
} from "api-server-api";

import { at } from "../platform";
import { ago, IDS, whenPopulated } from "../scenario";
import { NotFound } from "../trpc-server";
import { AGENTS } from "./agents";

// ---------------------------------------------------------------------------
// Skills

const ANTHROPIC_SKILLS_URL = "https://github.com/anthropics/skills";
const ACME_SKILLS_URL = "https://github.com/acme/eng-skills";
const ANTHROPIC_SHA = "c74d647e56e6daa12029b6acb11a821348ad044b";
const ACME_SHA = "4e9b1f07a2c3d85e6f10b2a9c7d4e3f5a6b8c901";
const SKILLS_HOME = "/home/agent/.agents/skills";

/** Deterministic 64-char hex digest standing in for a content hash. */
function hash(seed: string): string {
  let h = 2166136261;
  let out = "";
  while (out.length < 64) {
    for (const ch of seed + out.length) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 16777619) >>> 0;
    }
    out += h.toString(16).padStart(8, "0");
  }
  return out.slice(0, 64);
}

const SOURCES: SkillSource[] = [
  {
    id: "skill-src-seed-anthropic-skills",
    name: "Anthropic Skills",
    gitUrl: ANTHROPIC_SKILLS_URL,
    system: true,
  },
  {
    id: "skill-src-7d2a91c4",
    name: "Acme engineering skills",
    gitUrl: ACME_SKILLS_URL,
    path: ".claude/skills",
    canPublish: true,
  },
];

function skill(
  source: string,
  version: string,
  root: string,
  name: string,
  description: string,
): Skill {
  return {
    source,
    name,
    description,
    version,
    contentHash: hash(`${source}/${name}`),
    dir: `${root}/${name}`,
  };
}

const anthropic = (name: string, description: string) =>
  skill(ANTHROPIC_SKILLS_URL, ANTHROPIC_SHA, "skills", name, description);
const acme = (name: string, description: string) =>
  skill(ACME_SKILLS_URL, ACME_SHA, ".claude/skills", name, description);

const SKILLS_BY_SOURCE: Record<string, Skill[]> = {
  "skill-src-seed-anthropic-skills": [
    anthropic(
      "algorithmic-art",
      "Create generative art with p5.js using seeded randomness, flow fields, and particle systems.",
    ),
    anthropic(
      "brand-guidelines",
      "Apply Anthropic's official brand colors and typography to artifacts that should match its look and feel.",
    ),
    anthropic(
      "canvas-design",
      "Create visual art in .png and .pdf documents using design philosophy — posters, covers, and static pieces.",
    ),
    anthropic(
      "docx",
      "Create, edit, and analyze Word documents, including tracked changes, comments, and formatting.",
    ),
    anthropic(
      "frontend-design",
      "Build distinctive, production-grade frontend interfaces that avoid generic AI aesthetics.",
    ),
    anthropic(
      "internal-comms",
      "Write internal communications — status reports, leadership updates, incident reports, and FAQs.",
    ),
    anthropic(
      "mcp-builder",
      "Guide for creating high-quality MCP servers that let LLMs interact with external services.",
    ),
    anthropic(
      "pdf",
      "Extract text and tables, create, merge, split, and fill forms in PDF documents.",
    ),
    anthropic(
      "pptx",
      "Create, edit, and analyze PowerPoint presentations, layouts, and speaker notes.",
    ),
    anthropic(
      "skill-creator",
      "Guide for creating effective skills that extend an agent with specialized knowledge and workflows.",
    ),
    anthropic(
      "webapp-testing",
      "Test local web applications with Playwright: verify behavior, capture screenshots, and read browser logs.",
    ),
    anthropic(
      "xlsx",
      "Create, edit, and analyze spreadsheets with formulas, formatting, and charts.",
    ),
  ],
  "skill-src-7d2a91c4": [
    acme(
      "code-review",
      "Review a pull request against Acme's backend conventions and leave inline comments.",
    ),
    acme(
      "db-migrations",
      "Write reversible Postgres migrations with the team's naming, locking, and backfill rules.",
    ),
    acme(
      "incident-report",
      "Draft a post-incident report from a Slack thread, timeline, and linked dashboards.",
    ),
    acme(
      "release-notes",
      "Summarize merged pull requests since the last tag into customer-facing release notes.",
    ),
    acme(
      "stripe-webhooks",
      "Implement and test idempotent Stripe webhook handlers with signature verification.",
    ),
  ],
};

const findSkill = (sourceId: string, name: string) =>
  SKILLS_BY_SOURCE[sourceId]?.find((s) => s.name === name);

const ref = (sourceId: string, name: string, stale = false): SkillRef => {
  const s = findSkill(sourceId, name)!;
  return {
    source: s.source,
    name: s.name,
    version: stale ? "9a1c3e5f7b2d4068ac1e3f5b7d9a2c4e6f8b0d12" : s.version,
    contentHash: stale ? hash(`${s.source}/${s.name}@old`) : s.contentHash,
  };
};

const SYSTEM_SKILLS: LocalSkill[] = [
  {
    name: "platform-artifacts",
    description:
      "Write interactive HTML artifacts: buttons that send prompts to the open chat, and pages that share state with the agent.",
    skillPath: SKILLS_HOME,
    origin: "system",
    contentHash:
      "eb80b4461fc782fa238f15957ff56217a18e3b15c164c718c813486c6ff0d1db",
  },
  {
    name: "platform-schedules",
    description:
      "REQUIRED scheduler for any work that fires after the current turn ends: recurring tasks, future one-offs, and polls.",
    skillPath: SKILLS_HOME,
    origin: "system",
    contentHash:
      "03b15d5c43d7c812cc0eec186c729314c09d31a84e27e5b15cf6315227fe3530",
  },
  {
    name: "platform-models",
    description:
      "List the model providers this agent is connected to and switch the model a session uses.",
    skillPath: SKILLS_HOME,
    origin: "system",
    contentHash:
      "8eba4a81178fc5465bdda605cdbd4af09b9818a503a2346d74bdcfa1ce7aba7b",
  },
  {
    name: "dam-invoke",
    description:
      "Hand a task to another of the owner's agents and wait for its answer.",
    skillPath: SKILLS_HOME,
    origin: "system",
    contentHash:
      "6399de5b7deaca8c5681065f49006c0095dc9b3eaad4824769cc5b6b7bf44b42",
  },
];

const CHECKOUT_RUNBOOK: LocalSkill = {
  name: "checkout-runbook",
  description:
    "On-call runbook for checkout-service: triage failed payments, replay webhooks, and roll back a bad deploy.",
  skillPath: SKILLS_HOME,
  origin: "user",
  contentHash: hash("checkout-runbook"),
};

interface AgentSkills {
  installed: SkillRef[];
  standalone: LocalSkill[];
  instancePublishes: SkillPublishRecord[];
}

const AGENT_SKILLS: Record<string, AgentSkills> = {
  [IDS.codingAgent]: {
    installed: [
      ref("skill-src-seed-anthropic-skills", "webapp-testing"),
      ref("skill-src-seed-anthropic-skills", "mcp-builder"),
      ref("skill-src-7d2a91c4", "code-review"),
      ref("skill-src-7d2a91c4", "db-migrations", true),
      ref("skill-src-7d2a91c4", "stripe-webhooks"),
    ],
    standalone: [...SYSTEM_SKILLS, CHECKOUT_RUNBOOK],
    instancePublishes: [
      {
        skillName: "checkout-runbook",
        sourceId: "skill-src-7d2a91c4",
        sourceName: "Acme engineering skills",
        sourceGitUrl: ACME_SKILLS_URL,
        prUrl: "https://github.com/acme/eng-skills/pull/48",
        publishedAt: ago(60 * 5),
        prState: "open",
        prStateCheckedAt: ago(4),
      },
    ],
  },
  [IDS.kbAgent]: {
    installed: [
      ref("skill-src-seed-anthropic-skills", "pdf"),
      ref("skill-src-seed-anthropic-skills", "docx"),
    ],
    standalone: SYSTEM_SKILLS,
    instancePublishes: [],
  },
  [IDS.slackAgent]: {
    installed: [
      ref("skill-src-seed-anthropic-skills", "internal-comms"),
      ref("skill-src-7d2a91c4", "incident-report"),
    ],
    standalone: SYSTEM_SKILLS,
    instancePublishes: [],
  },
  [IDS.hibernatedAgent]: {
    installed: [ref("skill-src-seed-anthropic-skills", "xlsx")],
    standalone: SYSTEM_SKILLS,
    instancePublishes: [],
  },
};

const SKILL_SETS: SkillSet[] = [
  {
    id: "skillset-3c81f0a2",
    name: "backend-defaults",
    skills: [
      { source: ACME_SKILLS_URL, name: "code-review" },
      { source: ACME_SKILLS_URL, name: "db-migrations" },
      { source: ANTHROPIC_SKILLS_URL, name: "webapp-testing" },
    ],
    createdAt: ago(60 * 24 * 18),
  },
  {
    id: "skillset-9b04d7e6",
    name: "office-docs",
    skills: [
      { source: ANTHROPIC_SKILLS_URL, name: "docx" },
      { source: ANTHROPIC_SKILLS_URL, name: "pptx" },
      { source: ANTHROPIC_SKILLS_URL, name: "xlsx" },
      { source: ANTHROPIC_SKILLS_URL, name: "pdf" },
    ],
    createdAt: ago(60 * 24 * 33),
  },
];

function skillMarkdown(name: string, description: string, body: string) {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;
}

const RUNBOOK_BODY = `# checkout-service runbook

## Failed payments spike
1. Check the \`payments_failed_total\` panel on the checkout dashboard.
2. Group failures by \`decline_code\`. A single code usually means a provider incident — check status.stripe.com.
3. If failures are ours, find the release in #deploys and roll back with \`mise run deploy:rollback checkout-service\`.

## Replaying webhooks
Stripe retries for 3 days. To replay sooner:

\`\`\`sh
stripe events resend evt_... --webhook-endpoint we_...
\`\`\`

Handlers are idempotent on \`event.id\`, so replays are safe.

## Rolling back
- Roll back first, investigate second.
- Post in #incidents with the release SHA and the rollback time.
`;

const skillsFor = (agentId: string): AgentSkills =>
  whenPopulated(AGENT_SKILLS[agentId], undefined) ?? {
    installed: [],
    standalone: [],
    instancePublishes: [],
  };

const agentExists = (agentId: string) =>
  whenPopulated(AGENTS, []).some((a) => a.id === agentId);

const skillsEntries = [
  at("skills.sources.list", () => whenPopulated(SOURCES, [])),
  at("skills.listWithScan", ({ sourceId }) => {
    const skills = SKILLS_BY_SOURCE[sourceId];
    if (!skills) throw new NotFound();
    return {
      skills,
      scannedAt: ago(12),
      visibility:
        sourceId === "skill-src-7d2a91c4"
          ? ("private" as const)
          : ("public" as const),
    };
  }),
  at("skills.list", ({ sourceId }) => {
    const skills = SKILLS_BY_SOURCE[sourceId];
    if (!skills) throw new NotFound();
    return skills;
  }),
  at("skills.getSkillContent", ({ sourceId, name }) => {
    const s = findSkill(sourceId, name);
    if (!s) throw new NotFound();
    return {
      content: skillMarkdown(
        s.name,
        s.description,
        `# ${s.name}\n\n${s.description}\n\n## When to use\nUse this skill whenever the task matches the description above.\n`,
      ),
      dir: s.dir,
    };
  }),
  at("skills.state", ({ agentId }) => {
    if (!agentExists(agentId)) throw new NotFound();
    const s = skillsFor(agentId);
    return {
      ...s,
      standaloneSnapshot: { capturedAt: ago(3) },
    };
  }),
  at("skills.listLocal", ({ agentId }) => skillsFor(agentId).standalone),
  at("skills.readLocal", ({ agentId, name }) => {
    const local = skillsFor(agentId).standalone.find((s) => s.name === name);
    if (!local) throw new NotFound();
    const body =
      name === CHECKOUT_RUNBOOK.name
        ? RUNBOOK_BODY
        : `# ${name}\n\n${local.description}\n`;
    return {
      dir: `${SKILLS_HOME}/${name}`,
      files: [
        {
          relPath: "SKILL.md",
          content: skillMarkdown(name, local.description, body),
        },
      ],
    };
  }),
  at("skills.sets.list", () => whenPopulated(SKILL_SETS, [])),
];

// ---------------------------------------------------------------------------
// Artifact library

const SHARE_BASE_URL = "https://share.agents.example.com";

const FOLDERS = [
  {
    id: "fld-reports",
    name: "Reports",
    slug: "reports",
    created: 60 * 24 * 28,
  },
  {
    id: "fld-design-docs",
    name: "Design docs",
    slug: "design-docs",
    created: 60 * 24 * 20,
  },
  {
    id: "fld-platform-docs",
    name: "Platform docs",
    slug: "platform-docs",
    created: 60 * 24 * 30,
  },
];

const LATENCY_REPORT_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><title>Checkout latency — September</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:32px;color:#1c1917;background:#fafaf9}h1{font-size:22px;margin:0 0 4px}p.sub{color:#78716c;margin:0 0 24px}table{border-collapse:collapse;width:100%;max-width:640px}th,td{text-align:left;padding:8px 12px;border-bottom:1px solid #e7e5e4}th{font-weight:600;color:#57534e}td.num{text-align:right;font-variant-numeric:tabular-nums}.up{color:#b91c1c}.down{color:#15803d}</style></head>
<body><h1>Checkout latency — September</h1><p class="sub">p95 by endpoint, production, 1–28 Sep</p>
<table><thead><tr><th>Endpoint</th><th>p95 (ms)</th><th>vs Aug</th></tr></thead><tbody>
<tr><td>POST /v1/checkout</td><td class="num">412</td><td class="num down">−18%</td></tr>
<tr><td>POST /v1/payments/confirm</td><td class="num">688</td><td class="num up">+6%</td></tr>
<tr><td>GET /v1/cart</td><td class="num">94</td><td class="num down">−3%</td></tr>
<tr><td>POST /v1/refunds</td><td class="num">301</td><td class="num down">−22%</td></tr>
</tbody></table>
<p>The confirm regression tracks the Stripe SDK upgrade on 14 Sep; the rest improved after the cart cache landed.</p>
</body></html>`;

const LATENCY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320" viewBox="0 0 640 320"><rect width="640" height="320" fill="#fafaf9"/><text x="24" y="36" font-family="system-ui" font-size="16" fill="#1c1917">p95 latency, POST /v1/checkout (ms)</text><g stroke="#e7e5e4"><line x1="48" y1="80" x2="616" y2="80"/><line x1="48" y1="160" x2="616" y2="160"/><line x1="48" y1="240" x2="616" y2="240"/></g><g font-family="system-ui" font-size="12" fill="#78716c"><text x="16" y="84">600</text><text x="16" y="164">400</text><text x="16" y="244">200</text></g><polyline fill="none" stroke="#2563eb" stroke-width="3" points="48,118 104,112 160,124 216,108 272,120 328,146 384,152 440,160 496,158 552,164 616,166"/></svg>`;

const REFUND_DESIGN_MD = `# Refund idempotency keys

## Problem
Retries from the admin console and the support bot can issue the same refund twice. We saw 14 duplicate refunds in August.

## Proposal
- Accept an \`Idempotency-Key\` header on \`POST /v1/refunds\`.
- Store \`(merchant_id, key) → response\` for 24 hours in Postgres.
- A replay with the same key returns the stored response with \`Idempotent-Replayed: true\`.
- A replay with a different body returns \`422 idempotency_key_reused\`.

## Rollout
1. Ship behind \`refunds.idempotency\` flag.
2. Update the admin console and triage-bot to send keys.
3. Make the header required after two weeks of clean metrics.
`;

const WEBHOOK_FLAKE_MD = `# Webhook retry test flake

\`test_webhook_retry_backoff\` fails about 1 run in 30 on CI.

## Cause
The test asserts the second attempt lands after exactly 2s, but the retry scheduler adds up to 250ms of jitter.

## Fix
Freeze the clock with \`freezegun\` and assert on the scheduled time instead of wall time. Opened #1182.
`;

const REFUND_PATCH = `export async function createRefund(req: RefundRequest, db: Db) {
  const key = req.headers["idempotency-key"];
  if (key) {
    const prior = await db.idempotency.find(req.merchantId, key);
    if (prior) {
      if (prior.bodyHash !== hashBody(req.body)) {
        throw new ApiError(422, "idempotency_key_reused");
      }
      return { ...prior.response, replayed: true };
    }
  }
  const refund = await stripe.refunds.create(toStripe(req.body));
  if (key) await db.idempotency.save(req.merchantId, key, req.body, refund);
  return refund;
}
`;

const ARCH_OVERVIEW_MD = `# Platform architecture overview

The platform runs each agent in its own sandbox with an egress gateway in front of it.

## Pieces
- **api-server** — owns agents, connections, schedules, and the artifact library.
- **controller** — reconciles Agent resources into pods and volumes.
- **agent-runtime** — runs inside the sandbox and drives the harness.
- **egress gateway** — injects credentials and enforces egress rules.

## Requests leaving a sandbox
Every outbound request goes through the gateway. A host with no rule lands in the owner's inbox for approval.
`;

const ONBOARDING_MD = `# Onboarding: your first agent

1. Connect a model provider in **Settings → Providers**.
2. Create an agent and pick a harness.
3. Grant the connections it needs — GitHub is the usual first one.
4. Start a chat and describe the task.
`;

const HELP_DIGEST_MD = `# #help-platform — week of 22 Sep

**41 questions**, 33 answered by triage-bot, 8 escalated.

## Top themes
- Egress approvals for new package registries (11)
- GitHub connection scopes for org repos (7)
- Scheduling agents outside working hours (5)

## Escalated
- Private registry behind a self-signed CA — needs a Kubernetes connection with a CA bundle.
- Budget reset timing for the data team.
`;

const OPEN_TICKETS_CSV = `id,opened,topic,status
HELP-2291,2026-09-24,egress approval for pypi mirror,answered
HELP-2294,2026-09-24,github org SSO scopes,escalated
HELP-2298,2026-09-25,schedule skipped during quiet window,answered
HELP-2301,2026-09-26,agent hibernates too quickly,answered
HELP-2305,2026-09-27,self-signed CA for internal registry,escalated
`;

const ETL_LOG = `2026-09-18T02:00:04Z start nightly-etl run=20260918
2026-09-18T02:00:11Z extract orders rows=184,203
2026-09-18T02:03:47Z extract refunds rows=2,911
2026-09-18T02:05:02Z transform revenue_by_region ok
2026-09-18T02:06:30Z load bigquery analytics.revenue_daily rows=412
2026-09-18T02:06:31Z done in 6m27s
`;

const REVENUE_JSX = `export default function RevenueByRegion() {
  const rows = [
    ["North America", 4.82],
    ["Europe", 3.11],
    ["APAC", 1.94],
    ["LATAM", 0.62],
  ];
  return (
    <div style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1 style={{ fontSize: 20 }}>Revenue by region, Q3 ($M)</h1>
      {rows.map(([region, value]) => (
        <div key={region} style={{ display: "flex", gap: 12, margin: "8px 0" }}>
          <span style={{ width: 120 }}>{region}</span>
          <div style={{ width: value * 80, background: "#2563eb", borderRadius: 4 }} />
          <span>{value}</span>
        </div>
      ))}
    </div>
  );
}
`;

interface ArtifactDef {
  id: string;
  title: string;
  kind: LibraryArtifact["kind"];
  contentType: string;
  fileName: string;
  content: string;
  folderId: string | null;
  agentId: string | null;
  sourcePath?: string;
  visibility?: LibraryArtifact["visibility"];
  interactive?: boolean;
  viewers?: string[];
  viewCount?: number;
  version?: number;
  created: number;
  updated: number;
  expiresInMinutes?: number;
}

const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)));

const ARTIFACT_DEFS: ArtifactDef[] = [
  {
    id: "art-latency-report",
    title: "Checkout latency — September",
    kind: "html",
    contentType: "text/html",
    fileName: "checkout-latency-september.html",
    content: LATENCY_REPORT_HTML,
    folderId: "fld-reports",
    agentId: IDS.codingAgent,
    sourcePath: "/home/agent/work/reports/checkout-latency-september.html",
    visibility: "public",
    viewCount: 23,
    version: 3,
    created: 60 * 24 * 2,
    updated: 30,
  },
  {
    id: "art-latency-chart",
    title: "p95 latency, POST /v1/checkout",
    kind: "binary",
    contentType: "image/svg+xml",
    fileName: "checkout-p95.svg",
    content: LATENCY_SVG,
    folderId: "fld-reports",
    agentId: IDS.codingAgent,
    created: 60 * 24 * 2,
    updated: 60 * 24 * 2,
  },
  {
    id: "art-refund-design",
    title: "Refund idempotency keys",
    kind: "markdown",
    contentType: "text/markdown",
    fileName: "refund-idempotency.md",
    content: REFUND_DESIGN_MD,
    folderId: "fld-design-docs",
    agentId: IDS.codingAgent,
    sourcePath: "/home/agent/work/docs/refund-idempotency.md",
    visibility: "restricted",
    viewers: ["priya@example.com", "marco@example.com"],
    viewCount: 6,
    version: 2,
    created: 60 * 5,
    updated: 60 * 4 + 20,
  },
  {
    id: "art-refund-patch",
    title: "Refund handler with idempotency",
    kind: "code",
    contentType: "text/typescript",
    fileName: "create-refund.ts",
    content: REFUND_PATCH,
    folderId: null,
    agentId: IDS.codingAgent,
    sourcePath:
      "/home/agent/work/checkout-service/src/refunds/create-refund.ts",
    created: 60 * 4 + 40,
    updated: 60 * 4 + 40,
  },
  {
    id: "art-webhook-flake",
    title: "Webhook retry test flake",
    kind: "markdown",
    contentType: "text/markdown",
    fileName: "webhook-retry-flake.md",
    content: WEBHOOK_FLAKE_MD,
    folderId: null,
    agentId: IDS.codingAgent,
    created: 60 * 25 + 40,
    updated: 60 * 25 + 40,
  },
  {
    id: "art-arch-overview",
    title: "Platform architecture overview",
    kind: "markdown",
    contentType: "text/markdown",
    fileName: "architecture-overview.md",
    content: ARCH_OVERVIEW_MD,
    folderId: "fld-platform-docs",
    agentId: IDS.kbAgent,
    visibility: "public",
    viewCount: 57,
    version: 4,
    created: 60 * 24 * 14,
    updated: 60 * 3,
  },
  {
    id: "art-onboarding",
    title: "Onboarding: your first agent",
    kind: "markdown",
    contentType: "text/markdown",
    fileName: "onboarding.md",
    content: ONBOARDING_MD,
    folderId: "fld-platform-docs",
    agentId: IDS.kbAgent,
    created: 60 * 24 * 10,
    updated: 60 * 24 * 10,
  },
  {
    id: "art-help-digest",
    title: "#help-platform digest — week of 22 Sep",
    kind: "markdown",
    contentType: "text/markdown",
    fileName: "help-platform-digest-2026-09-22.md",
    content: HELP_DIGEST_MD,
    folderId: "fld-reports",
    agentId: IDS.slackAgent,
    visibility: "public",
    viewCount: 12,
    created: 60 * 24 * 2 + 90,
    updated: 60 * 24 * 2 + 90,
    expiresInMinutes: 60 * 24 * 28,
  },
  {
    id: "art-open-tickets",
    title: "Open support tickets",
    kind: "text",
    contentType: "text/csv",
    fileName: "open-tickets.csv",
    content: OPEN_TICKETS_CSV,
    folderId: null,
    agentId: IDS.slackAgent,
    created: 60 * 24 * 3,
    updated: 60 * 20,
    version: 5,
  },
  {
    id: "art-revenue-region",
    title: "Revenue by region, Q3",
    kind: "jsx",
    contentType: "text/jsx",
    fileName: "revenue-by-region.jsx",
    content: REVENUE_JSX,
    folderId: "fld-reports",
    agentId: IDS.hibernatedAgent,
    created: 60 * 24 * 11,
    updated: 60 * 24 * 11,
  },
  {
    id: "art-etl-log",
    title: "Nightly ETL run log",
    kind: "text",
    contentType: "text/plain",
    fileName: "nightly-etl-20260918.log",
    content: ETL_LOG,
    folderId: null,
    agentId: IDS.hibernatedAgent,
    created: 60 * 24 * 12,
    updated: 60 * 24 * 12,
  },
];

const slugOf = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function toArtifact(d: ArtifactDef): LibraryArtifact {
  const visibility = d.visibility ?? "private";
  const slug = `${slugOf(d.title)}-${d.id.slice(-4)}`;
  return {
    id: d.id,
    title: d.title,
    slug,
    kind: d.kind,
    contentType: d.contentType,
    fileName: d.fileName,
    sizeBytes: new TextEncoder().encode(d.content).length,
    version: d.version ?? 1,
    folderId: d.folderId,
    agentId: d.agentId,
    sourcePath: d.sourcePath ?? null,
    visibility,
    interactive: d.interactive ?? false,
    expiresAt:
      d.expiresInMinutes === undefined ? null : ago(-d.expiresInMinutes),
    viewCount: d.viewCount ?? 0,
    shareUrl: visibility === "private" ? null : `${SHARE_BASE_URL}/a/${slug}`,
    viewers: d.viewers ?? [],
    createdAt: ago(d.created),
    updatedAt: ago(d.updated),
  };
}

const artifactDefs = () => whenPopulated(ARTIFACT_DEFS, []);
const artifacts = () => artifactDefs().map(toArtifact);

const defFor = (id: string) => {
  const d = artifactDefs().find((a) => a.id === id);
  if (!d) throw new NotFound();
  return d;
};

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );

const PREVIEW_CSS =
  "body{font:15px/1.6 system-ui,sans-serif;margin:32px;max-width:720px;color:#1c1917;background:#fafaf9}h1{font-size:22px}h2{font-size:17px;margin-top:24px}code{background:#f5f5f4;padding:1px 4px;border-radius:4px}pre{background:#f5f5f4;padding:12px;border-radius:6px;overflow:auto;font-size:13px}";

function inline(s: string) {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

/** A small Markdown subset, enough for the fixture documents. */
function markdownToHtml(md: string): string {
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  let code: string[] | null = null;
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const line of md.split("\n")) {
    if (line.startsWith("```")) {
      if (code) {
        out.push(`<pre>${escapeHtml(code.join("\n"))}</pre>`);
        code = null;
      } else {
        closeList();
        code = [];
      }
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }
    const h = /^(#{1,3}) (.*)$/.exec(line);
    const ul = /^- (.*)$/.exec(line);
    const ol = /^\d+\. (.*)$/.exec(line);
    if (h) {
      closeList();
      out.push(`<h${h[1]!.length}>${inline(h[2]!)}</h${h[1]!.length}>`);
    } else if (ul || ol) {
      const want = ul ? "ul" : "ol";
      if (list !== want) {
        closeList();
        out.push(`<${want}>`);
        list = want;
      }
      out.push(`<li>${inline((ul ?? ol)![1]!)}</li>`);
    } else if (line.trim() === "") {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return out.join("\n");
}

function page(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title><style>${PREVIEW_CSS}</style></head><body>${body}</body></html>`;
}

function previewHtml(d: ArtifactDef): string | null {
  switch (d.kind) {
    case "binary":
      return null;
    case "html":
      return d.content;
    case "markdown":
      return page(d.title, markdownToHtml(d.content));
    case "jsx":
      return page(
        d.title,
        `<h1>Revenue by region, Q3 ($M)</h1>${[
          ["North America", 4.82],
          ["Europe", 3.11],
          ["APAC", 1.94],
          ["LATAM", 0.62],
        ]
          .map(
            ([r, v]) =>
              `<div style="display:flex;gap:12px;margin:8px 0;align-items:center"><span style="width:120px">${r}</span><div style="width:${Number(v) * 80}px;height:16px;background:#2563eb;border-radius:4px"></div><span>${v}</span></div>`,
          )
          .join("")}`,
      );
    default:
      return page(
        d.title,
        `<p><code>${escapeHtml(d.fileName)}</code></p><pre>${escapeHtml(d.content)}</pre>`,
      );
  }
}

/** Which artifacts the checkout-service chats wrote to. */
const TOUCHES: { sessionId: string; artifactId: string; minutesAgo: number }[] =
  [
    {
      sessionId: IDS.session1,
      artifactId: "art-latency-report",
      minutesAgo: 30,
    },
    {
      sessionId: IDS.session2,
      artifactId: "art-refund-design",
      minutesAgo: 260,
    },
    {
      sessionId: IDS.session2,
      artifactId: "art-refund-patch",
      minutesAgo: 280,
    },
    {
      sessionId: IDS.session3,
      artifactId: "art-webhook-flake",
      minutesAgo: 1540,
    },
  ];

const artifactEntries = [
  at("artifactLibrary.list", (input) => {
    const q = input?.search?.toLowerCase();
    return artifacts()
      .filter(
        (a) => input?.agentId === undefined || a.agentId === input.agentId,
      )
      .filter(
        (a) => input?.folderId === undefined || a.folderId === input.folderId,
      )
      .filter(
        (a) =>
          !q ||
          a.title.toLowerCase().includes(q) ||
          a.fileName.toLowerCase().includes(q),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }),
  at("artifactLibrary.listFolders", () =>
    whenPopulated(FOLDERS, []).map((f) => ({
      id: f.id,
      name: f.name,
      slug: f.slug,
      artifactCount: ARTIFACT_DEFS.filter((a) => a.folderId === f.id).length,
      createdAt: ago(f.created),
      updatedAt: ago(f.created),
    })),
  ),
  at("artifactLibrary.get", ({ id }) => toArtifact(defFor(id))),
  at("artifactLibrary.getContent", ({ id }) => {
    const d = defFor(id);
    const binary = d.kind === "binary";
    return {
      kind: d.kind,
      contentType: d.contentType,
      fileName: d.fileName,
      content: binary ? b64(d.content) : d.content,
      binary,
      tooLarge: false,
    };
  }),
  at("artifactLibrary.preview", ({ id }) => previewHtml(defFor(id))),
  at("artifactLibrary.listVersions", ({ id }) => {
    const d = defFor(id);
    const count = d.version ?? 1;
    const size = new TextEncoder().encode(d.content).length;
    return Array.from({ length: count }, (_, i) => {
      const version = count - i;
      const span = d.created - d.updated;
      const minutes =
        count === 1
          ? d.created
          : d.created - (span * (version - 1)) / (count - 1);
      return {
        version,
        contentType: d.contentType,
        sizeBytes: Math.max(64, size - (count - version) * 180),
        createdAt: ago(Math.round(minutes)),
        author:
          version === count && count > 2
            ? ("user" as const)
            : ("agent" as const),
      };
    });
  }),
  at("artifactLibrary.folderShareUrl", ({ id }) => {
    const f = FOLDERS.find((x) => x.id === id);
    if (!f) throw new NotFound();
    return null;
  }),
  at("artifactLibrary.touches", ({ sessionIds, limit }) =>
    whenPopulated(TOUCHES, [])
      .filter((t) => sessionIds.includes(t.sessionId))
      .slice(0, limit ?? 200)
      .map((t) => {
        const d = defFor(t.artifactId);
        return {
          artifactId: t.artifactId,
          version: d.version ?? 1,
          sessionId: t.sessionId,
          touchedAt: ago(t.minutesAgo),
          fileName: d.fileName,
        };
      }),
  ),
];

// ---------------------------------------------------------------------------
// Channels and runtime

const channelEntries = [
  // The install has no Telegram bot configured (channels.available is
  // Slack-only), so the bot username is absent and no chats are bound.
  at("channels.telegramBot", null),
  at("agents.listTelegramChats", ({ agentId }) => {
    if (!agentExists(agentId)) throw new NotFound();
    return { chats: [] };
  }),
  at("agents.planRuntimeMigration", ({ id }) => {
    if (!agentExists(id)) throw new NotFound();
    return {
      unmovable: [],
      storageSize: "10Gi",
      storageResized: false,
      bootsSleepingAgent: id === IDS.hibernatedAgent,
      retentionMs: 7 * 24 * 60 * 60_000,
      allowed: false,
      refusal: {
        type: "VirtualizationDisabled" as const,
        reasons: ["virtualization is not enabled on this install"],
      },
    };
  }),
];

export const sandboxEntries = [
  ...skillsEntries,
  ...artifactEntries,
  ...channelEntries,
];
