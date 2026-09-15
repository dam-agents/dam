import { AGENT_IDS } from "./agents.js";

const now = Date.now();
const min = 60_000;
const hr = 60 * min;
const day = 24 * hr;

export const mockSessions = {
  // ── ci-pipeline: schedule working + read agent sessions ────────────────
  [AGENT_IDS.codexResearch]: [
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
    {
      sessionId: "sess-003",
      agentId: AGENT_IDS.codexResearch,
      type: "regular" as const,
      mode: "chat" as const,
      createdAt: new Date(now - day - 2 * hr).toISOString(),
      updatedAt: new Date(now - day - 40 * min).toISOString(),
      title: "Build Docker image for v2.4 release candidate",
      running: false,
      seenAt: new Date(now).toISOString(),
      artifactName: "release-v2.4-rc1-linux-amd64.tar.gz",
    },
  ],

  // ── bug-triage: agent working + unread + read ─────────────────────────
  [AGENT_IDS.geminiPipeline]: [
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
  ],

  // ── api-docs: slack working + read agent sessions ─────────────────────
  [AGENT_IDS.knowledgeBase]: [
    {
      sessionId: "sess-008",
      agentId: AGENT_IDS.knowledgeBase,
      type: "channel_slack" as const,
      mode: "chat" as const,
      createdAt: new Date(now - 15 * min).toISOString(),
      updatedAt: new Date(now - 6 * min).toISOString(),
      threadTs: "1725800000.000200",
      title: "Update REST API reference for v2.4 endpoints",
      running: true,
      seenAt: new Date(now - 12 * min).toISOString(),
      slackChannel: "api-docs",
    },
    {
      sessionId: "sess-009",
      agentId: AGENT_IDS.knowledgeBase,
      type: "schedule_cron" as const,
      mode: "chat" as const,
      createdAt: new Date(now - day - 6 * hr).toISOString(),
      updatedAt: new Date(now - day - 2 * hr).toISOString(),
      scheduleId: "sched-003",
      title: "Weekly OpenAPI spec sync",
      running: false,
      seenAt: new Date(now).toISOString(),
    },
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
  ],

  // ── pm-standup: unread schedule + read agent ──────────────────────────
  [AGENT_IDS.experiment1]: [
    {
      sessionId: "sess-012",
      agentId: AGENT_IDS.experiment1,
      type: "schedule_cron" as const,
      mode: "chat" as const,
      createdAt: new Date(now - 25 * min).toISOString(),
      updatedAt: new Date(now - 10 * min).toISOString(),
      scheduleId: "sched-004",
      title: "Daily standup summary — backend team",
      running: false,
      seenAt: new Date(now - 30 * min).toISOString(),
    },
    {
      sessionId: "sess-013",
      agentId: AGENT_IDS.experiment1,
      type: "regular" as const,
      mode: "chat" as const,
      createdAt: new Date(now - 2 * day - 4 * hr).toISOString(),
      updatedAt: new Date(now - 2 * day - 90 * min).toISOString(),
      title: "Sprint velocity report for Q3 planning",
      running: false,
      seenAt: new Date(now).toISOString(),
    },
  ],

  // ── code-review-bot: slack unread + read agent ────────────────────────
  [AGENT_IDS.claudeCodeMain]: [
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
    {
      sessionId: "sess-017",
      agentId: AGENT_IDS.claudeCodeMain,
      type: "regular" as const,
      mode: "chat" as const,
      createdAt: new Date(now - 3 * day - 3 * hr).toISOString(),
      updatedAt: new Date(now - 3 * day - 2 * hr).toISOString(),
      title: "Security review for OAuth token handling",
      running: false,
      seenAt: new Date(now).toISOString(),
    },
  ],
};
