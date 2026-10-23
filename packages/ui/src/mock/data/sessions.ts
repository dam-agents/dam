import { AGENT_IDS } from "./agents.js";

const now = Date.now();
const min = 60_000;
const hr = 60 * min;
const day = 24 * hr;

const agentTitles: Record<string, string[]> = {
  [AGENT_IDS.codexResearch]: [
    "Run integration tests on auth refactor",
    "Build and push staging image v2.14",
    "Deploy preview for PR #1827",
    "Rollback staging after flaky e2e",
    "Validate Helm chart changes",
    "Smoke test payment webhook handler",
    "Rebuild Docker cache after base bump",
    "Run load test — 500 concurrent users",
    "Check migration script on staging DB",
    "Deploy hotfix for rate limiter",
    "Verify TLS cert renewal in staging",
    "Run full regression suite — release branch",
  ],
  [AGENT_IDS.claudeCodeMain]: [
    "Review PR #2041 — session timeout fix",
    "Inline suggestions for query optimizer",
    "Security scan on dependency update",
    "Review PR #2038 — add retry middleware",
    "Flag unused exports in shared package",
    "Review PR #2033 — webhook signature check",
    "Suggest test coverage for billing module",
    "Review PR #2029 — rate limit headers",
    "Check for SQL injection in search endpoint",
    "Review PR #2025 — logging middleware",
    "Analyze type safety in API routes",
    "Review PR #2019 — pagination cursor",
  ],
  [AGENT_IDS.geminiPipeline]: [
    "Classify #4821 — login redirect loop",
    "Route crash report to mobile team",
    "Triage #4818 — stale cache on deploy",
    "Set P1 for data export timeout",
    "Classify #4815 — dark mode text contrast",
    "Deduplicate #4812 against known issue",
    "Route #4809 — Slack integration 403",
    "Classify #4806 — CSV export truncation",
    "Triage webhook delivery failures",
    "Auto-close #4800 — resolved by v2.13",
    "Classify #4798 — chart rendering glitch",
    "Route #4795 — team invite email delay",
  ],
  [AGENT_IDS.knowledgeBase]: [
    "Sync REST endpoints from router files",
    "Publish updated auth flow docs",
    "Generate TypeDoc for shared package",
    "Update webhook event reference",
    "Rebuild search index for API docs",
    "Sync GraphQL schema descriptions",
    "Publish changelog for v2.13 endpoints",
    "Update rate limit documentation",
    "Generate SDK examples for billing API",
    "Sync error codes from error catalog",
    "Publish migration guide for API v2→v3",
    "Update pagination docs with cursor spec",
  ],
  [AGENT_IDS.experiment1]: [
    "Collect standup from 12 merged PRs",
    "Post daily summary — Oct 3",
    "Flag blocked PR — needs DB migration",
    "Compile weekly velocity report",
    "Post daily summary — Oct 2",
    "Collect standup from 8 merged PRs",
    "Flag stale PR — open 14 days",
    "Post daily summary — Oct 1",
    "Compile sprint retrospective data",
    "Post daily summary — Sep 30",
    "Collect standup from 15 merged PRs",
    "Flag PR with failing checks",
  ],
  [AGENT_IDS.experiment2]: [
    "Sync color tokens from Figma library",
    "Push spacing scale update to CSS vars",
    "Detect drift in typography tokens",
    "Sync icon set additions — 6 new icons",
    "Push border radius token changes",
    "Detect removed token — alert team",
    "Sync shadow elevation tokens",
    "Push motion duration tokens",
    "Detect Figma variable rename — map update",
    "Sync responsive breakpoint tokens",
    "Push updated semantic color mappings",
    "Detect unused tokens in codebase",
  ],
  [AGENT_IDS.knowledgeBase2]: [
    "Scan npm audit — 2 moderate findings",
    "Check license compatibility for new dep",
    "Flag outdated React minor version",
    "Scan Go modules — all clear",
    "Check transitive dep for CVE-2026-1234",
    "Flag deprecated package — suggest alt",
    "Weekly audit report — 0 critical",
    "Scan Python requirements — 1 warning",
    "Check Helm chart dep versions",
    "Flag unmaintained package — last publish 2y",
    "Scan container base image CVEs",
    "Weekly audit report — 1 moderate",
  ],
};

const slackChannels = [
  "code-review",
  "incidents",
  "deployments",
  "api-docs",
  "engineering",
  "platform-alerts",
  "security",
];

function generateSessions(
  agentId: string,
  count: number,
  options?: {
    runningCount?: number;
    unreadCount?: number;
    slackRatio?: number;
    scheduleRatio?: number;
  },
) {
  const {
    runningCount = 1,
    unreadCount = 0,
    slackRatio = 0.2,
    scheduleRatio = 0.15,
  } = options ?? {};
  const titles = agentTitles[agentId] ?? agentTitles[AGENT_IDS.codexResearch]!;
  const sessions = [];

  for (let i = 0; i < count; i++) {
    const ageMs =
      i < 3 ? i * 30 * min : (i - 2) * 4 * hr + Math.random() * 2 * hr;
    const isRunning = i < runningCount;
    const isSlack = !isRunning && Math.random() < slackRatio;
    const isSchedule = !isRunning && !isSlack && Math.random() < scheduleRatio;
    const isUnread = !isRunning && i < unreadCount;

    const createdAt = new Date(now - ageMs - 30 * min).toISOString();
    const updatedAt = new Date(now - ageMs).toISOString();
    const seenAt =
      isRunning || isUnread
        ? new Date(now - ageMs - hr).toISOString()
        : new Date(now - ageMs + 10 * min).toISOString();

    sessions.push({
      sessionId: `sess-${agentId.slice(-4)}-${String(i).padStart(3, "0")}`,
      agentId,
      type: isSlack
        ? ("channel_slack" as const)
        : isSchedule
          ? ("schedule_cron" as const)
          : ("regular" as const),
      mode: "chat" as const,
      createdAt,
      updatedAt,
      title: titles[i % titles.length],
      running: isRunning,
      seenAt,
      ...(isSlack
        ? {
            threadTs: `17258${String(i).padStart(5, "0")}.000${i}`,
            slackChannel: slackChannels[i % slackChannels.length],
          }
        : {}),
      ...(isSchedule
        ? { scheduleId: `sched-${String(i).padStart(3, "0")}` }
        : {}),
    });
  }

  return sessions;
}

export const mockSessions: Record<string, unknown[]> = {
  [AGENT_IDS.codexResearch]: generateSessions(AGENT_IDS.codexResearch, 55, {
    runningCount: 2,
    unreadCount: 4,
    slackRatio: 0.1,
    scheduleRatio: 0.25,
  }),
  [AGENT_IDS.claudeCodeMain]: generateSessions(AGENT_IDS.claudeCodeMain, 58, {
    runningCount: 1,
    unreadCount: 3,
    slackRatio: 0.35,
    scheduleRatio: 0.05,
  }),
  [AGENT_IDS.geminiPipeline]: generateSessions(AGENT_IDS.geminiPipeline, 50, {
    runningCount: 0,
    slackRatio: 0.15,
    scheduleRatio: 0.1,
  }),
  [AGENT_IDS.knowledgeBase]: generateSessions(AGENT_IDS.knowledgeBase, 50, {
    runningCount: 0,
    slackRatio: 0.3,
    scheduleRatio: 0.2,
  }),
  [AGENT_IDS.experiment1]: generateSessions(AGENT_IDS.experiment1, 40, {
    runningCount: 0,
    slackRatio: 0.1,
    scheduleRatio: 0.3,
  }),
  [AGENT_IDS.experiment2]: generateSessions(AGENT_IDS.experiment2, 35, {
    runningCount: 0,
    slackRatio: 0.1,
    scheduleRatio: 0.2,
  }),
  [AGENT_IDS.knowledgeBase2]: generateSessions(AGENT_IDS.knowledgeBase2, 30, {
    runningCount: 0,
    slackRatio: 0.2,
    scheduleRatio: 0.15,
  }),
};
