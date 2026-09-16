import { AGENT_IDS } from "./agents.js";

const now = Date.now();
const min = 60_000;
const hr = 60 * min;
const day = 24 * hr;

export const mockSessions = {
  // ── ci-pipeline ──────────────────────────────────────────────────────────
  [AGENT_IDS.codexResearch]: [
    // WORKING — schedule running (today)
    {
      sessionId: "sess-002",
      agentId: AGENT_IDS.codexResearch,
      type: "schedule_cron" as const,
      mode: "chat" as const,
      createdAt: new Date(now - 25 * min).toISOString(),
      updatedAt: new Date(now - 3 * min).toISOString(),
      scheduleId: "sched-001",
      title: "Nightly e2e test suite",
      running: true,
      seenAt: new Date(now - 20 * min).toISOString(),
    },
    // UNREAD — finished today
    {
      sessionId: "sess-003",
      agentId: AGENT_IDS.codexResearch,
      type: "regular" as const,
      mode: "chat" as const,
      createdAt: new Date(now - 2 * hr).toISOString(),
      updatedAt: new Date(now - 45 * min).toISOString(),
      title: "Build Docker image for v2.4 release candidate",
      running: false,
      seenAt: new Date(now - 3 * hr).toISOString(),
      artifactName: "release-v2.4-rc1-linux-amd64.tar.gz",
    },
    // READ — yesterday
    {
      sessionId: "sess-003b",
      agentId: AGENT_IDS.codexResearch,
      type: "regular" as const,
      mode: "chat" as const,
      createdAt: new Date(now - day - 2 * hr).toISOString(),
      updatedAt: new Date(now - day - 40 * min).toISOString(),
      title: "Deploy staging environment for QA",
      running: false,
      seenAt: new Date(now).toISOString(),
    },
    // READ — last 30 days (15 days ago)
    {
      sessionId: "sess-020",
      agentId: AGENT_IDS.codexResearch,
      type: "regular" as const,
      mode: "chat" as const,
      createdAt: new Date(now - 15 * day - 3 * hr).toISOString(),
      updatedAt: new Date(now - 15 * day - hr).toISOString(),
      title: "Benchmark database query performance",
      running: false,
      seenAt: new Date(now).toISOString(),
    },
  ],

  // ── bug-triage ───────────────────────────────────────────────────────────
  [AGENT_IDS.geminiPipeline]: [
    // WORKING — agent running (today)
    {
      sessionId: "sess-004",
      agentId: AGENT_IDS.geminiPipeline,
      type: "regular" as const,
      mode: "chat" as const,
      createdAt: new Date(now - 5 * min).toISOString(),
      updatedAt: new Date(now - 2 * min).toISOString(),
      title: "Triage and label open issues from last sprint",
      running: true,
      seenAt: new Date(now - 4 * min).toISOString(),
    },
    // UNREAD — finished today
    {
      sessionId: "sess-005",
      agentId: AGENT_IDS.geminiPipeline,
      type: "regular" as const,
      mode: "chat" as const,
      createdAt: new Date(now - 90 * min).toISOString(),
      updatedAt: new Date(now - 30 * min).toISOString(),
      title: "Classify P2 bugs from customer reports",
      running: false,
      seenAt: new Date(now - 2 * hr).toISOString(),
    },
    // READ — yesterday
    {
      sessionId: "sess-006",
      agentId: AGENT_IDS.geminiPipeline,
      type: "regular" as const,
      mode: "chat" as const,
      createdAt: new Date(now - day - 3 * hr).toISOString(),
      updatedAt: new Date(now - day - 60 * min).toISOString(),
      title: "Investigate flaky test in payments module",
      running: false,
      seenAt: new Date(now).toISOString(),
    },
    // READ — last 7 days (4 days ago)
    {
      sessionId: "sess-021",
      agentId: AGENT_IDS.geminiPipeline,
      type: "regular" as const,
      mode: "chat" as const,
      createdAt: new Date(now - 4 * day - 2 * hr).toISOString(),
      updatedAt: new Date(now - 4 * day - hr).toISOString(),
      title: "Auto-close stale issues older than 90 days",
      running: false,
      seenAt: new Date(now).toISOString(),
    },
  ],

  // ── api-docs ─────────────────────────────────────────────────────────────
  [AGENT_IDS.knowledgeBase]: [
    // READ — slack, finished today
    {
      sessionId: "sess-008",
      agentId: AGENT_IDS.knowledgeBase,
      type: "channel_slack" as const,
      mode: "chat" as const,
      createdAt: new Date(now - 3 * hr).toISOString(),
      updatedAt: new Date(now - 2 * hr).toISOString(),
      threadTs: "1725800000.000200",
      title: "Update REST API reference for v2.4 endpoints",
      running: false,
      seenAt: new Date(now - hr).toISOString(),
      slackChannel: "api-docs",
    },
    // READ — schedule, finished today
    {
      sessionId: "sess-009",
      agentId: AGENT_IDS.knowledgeBase,
      type: "schedule_cron" as const,
      mode: "chat" as const,
      createdAt: new Date(now - 4 * hr).toISOString(),
      updatedAt: new Date(now - 3 * hr).toISOString(),
      scheduleId: "sched-003",
      title: "Weekly OpenAPI spec sync",
      running: false,
      seenAt: new Date(now - hr).toISOString(),
    },
    // READ — last 7 days (3 days ago)
    {
      sessionId: "sess-010",
      agentId: AGENT_IDS.knowledgeBase,
      type: "regular" as const,
      mode: "chat" as const,
      createdAt: new Date(now - 3 * day - 4 * hr).toISOString(),
      updatedAt: new Date(now - 3 * day - 50 * min).toISOString(),
      title: "Generate auth middleware migration guide",
      running: false,
      seenAt: new Date(now).toISOString(),
      artifactName: "auth-migration-guide.md",
    },
    // READ — older (45 days ago)
    {
      sessionId: "sess-022",
      agentId: AGENT_IDS.knowledgeBase,
      type: "regular" as const,
      mode: "chat" as const,
      createdAt: new Date(now - 45 * day - 5 * hr).toISOString(),
      updatedAt: new Date(now - 45 * day - 3 * hr).toISOString(),
      title: "Rebuild search index for knowledge base",
      running: false,
      seenAt: new Date(now).toISOString(),
    },
  ],

  // ── pm-standup ───────────────────────────────────────────────────────────
  [AGENT_IDS.experiment1]: [
    // READ — schedule, finished today
    {
      sessionId: "sess-012",
      agentId: AGENT_IDS.experiment1,
      type: "schedule_cron" as const,
      mode: "chat" as const,
      createdAt: new Date(now - 6 * hr).toISOString(),
      updatedAt: new Date(now - 5 * hr).toISOString(),
      scheduleId: "sched-004",
      title: "Daily standup summary — backend team",
      running: false,
      seenAt: new Date(now - 4 * hr).toISOString(),
    },
    // READ — last 30 days (12 days ago)
    {
      sessionId: "sess-013",
      agentId: AGENT_IDS.experiment1,
      type: "regular" as const,
      mode: "chat" as const,
      createdAt: new Date(now - 12 * day - 4 * hr).toISOString(),
      updatedAt: new Date(now - 12 * day - 90 * min).toISOString(),
      title: "Sprint velocity report for Q3 planning",
      running: false,
      seenAt: new Date(now).toISOString(),
    },
  ],

  // ── code-review-bot ──────────────────────────────────────────────────────
  [AGENT_IDS.claudeCodeMain]: [
    // UNREAD — slack, finished today
    {
      sessionId: "sess-016",
      agentId: AGENT_IDS.claudeCodeMain,
      type: "channel_slack" as const,
      mode: "chat" as const,
      createdAt: new Date(now - 50 * min).toISOString(),
      updatedAt: new Date(now - 25 * min).toISOString(),
      threadTs: "1725800000.000500",
      title: "Review PR #487 session history refactor",
      running: false,
      seenAt: new Date(now - 55 * min).toISOString(),
      slackChannel: "code-review",
    },
    // READ — finished today
    {
      sessionId: "sess-017",
      agentId: AGENT_IDS.claudeCodeMain,
      type: "channel_slack" as const,
      mode: "chat" as const,
      createdAt: new Date(now - 7 * hr).toISOString(),
      updatedAt: new Date(now - 6 * hr).toISOString(),
      threadTs: "1725800000.000600",
      title: "Security review for OAuth token handling",
      running: false,
      seenAt: new Date(now - 5 * hr).toISOString(),
      slackChannel: "code-review",
    },
    // READ — older (60 days ago)
    {
      sessionId: "sess-018",
      agentId: AGENT_IDS.claudeCodeMain,
      type: "regular" as const,
      mode: "chat" as const,
      createdAt: new Date(now - 60 * day - 3 * hr).toISOString(),
      updatedAt: new Date(now - 60 * day - 2 * hr).toISOString(),
      title: "Lint and format entire monorepo",
      running: false,
      seenAt: new Date(now).toISOString(),
    },
  ],
};
