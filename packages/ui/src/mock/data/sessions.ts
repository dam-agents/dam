import { AGENT_IDS } from "./agents.js";

const now = Date.now();
const min = 60_000;
const hr = 60 * min;

const slackChannels = [
  "code-review",
  "incidents",
  "deployments",
  "api-docs",
  "engineering",
  "platform-alerts",
  "security",
];

function makeSession(
  id: string,
  agentId: string,
  title: string,
  ageMs: number,
  opts?: {
    unread?: boolean;
    type?: "regular" | "channel_slack" | "schedule_cron";
    slackChannel?: string;
  },
) {
  const { unread = false, type = "regular", slackChannel } = opts ?? {};
  const createdAt = new Date(now - ageMs - 30 * min).toISOString();
  const updatedAt = new Date(now - ageMs).toISOString();
  const seenAt = unread
    ? new Date(now - ageMs - hr).toISOString()
    : new Date(now - ageMs + 10 * min).toISOString();

  return {
    sessionId: id,
    agentId,
    type,
    mode: "chat" as const,
    createdAt,
    updatedAt,
    title,
    running: false,
    seenAt,
    ...(type === "channel_slack"
      ? {
          threadTs: `17258${id.slice(-5)}.000`,
          slackChannel: slackChannel ?? slackChannels[0],
        }
      : {}),
    ...(type === "schedule_cron"
      ? { scheduleId: `sched-${id.slice(-3)}` }
      : {}),
  };
}

export const MOCK_SESSION_IDS = {
  artifact: "sess-artifact-example",
  browser: "sess-browser-example",
  longChat: "sess-long-chat-example",
  devFlow: "sess-dev-flow",
};

export const KIT_SESSION_TO_PACK: Record<string, string> = {};

const ciPipelineSessions = [
  makeSession(
    MOCK_SESSION_IDS.artifact,
    AGENT_IDS.codexResearch,
    "Fix flaky integration tests in auth module",
    15 * min,
    { unread: true },
  ),
  makeSession(
    "sess-ci-002",
    AGENT_IDS.codexResearch,
    "Docker image build for staging deploy",
    2 * hr,
  ),
  makeSession(
    MOCK_SESSION_IDS.browser,
    AGENT_IDS.codexResearch,
    "Browser session",
    3 * hr,
  ),
  makeSession(
    "sess-ci-004",
    AGENT_IDS.codexResearch,
    "Migrate CI pipeline to GitHub Actions",
    6 * hr,
  ),
  makeSession(
    MOCK_SESSION_IDS.longChat,
    AGENT_IDS.codexResearch,
    "Long chat stream example",
    8 * hr,
  ),
  makeSession(
    MOCK_SESSION_IDS.devFlow,
    AGENT_IDS.codexResearch,
    "Add CSV export to reports page",
    1 * hr,
  ),
  makeSession(
    "sess-ci-006",
    AGENT_IDS.codexResearch,
    "Set up parallel test runners",
    12 * hr,
  ),
  makeSession(
    "sess-ci-007",
    AGENT_IDS.codexResearch,
    "Debug OOM in build container",
    18 * hr,
    { type: "channel_slack", slackChannel: "deployments" },
  ),
  makeSession(
    "sess-ci-008",
    AGENT_IDS.codexResearch,
    "Configure artifact caching",
    24 * hr,
  ),
];

const securityScannerSessions = [
  makeSession(
    "sess-sec-001",
    AGENT_IDS.geminiPipeline,
    "Scan repositories for CVE-2026-3891",
    25 * min,
    { unread: true },
  ),
  makeSession(
    "sess-sec-002",
    AGENT_IDS.geminiPipeline,
    "Audit npm dependencies for known exploits",
    3 * hr,
  ),
  makeSession(
    "sess-sec-003",
    AGENT_IDS.geminiPipeline,
    "Secret leak detection in feature branches",
    7 * hr,
    { type: "channel_slack", slackChannel: "security" },
  ),
  makeSession(
    "sess-sec-004",
    AGENT_IDS.geminiPipeline,
    "SAST scan for SQL injection patterns",
    14 * hr,
  ),
  makeSession(
    "sess-sec-005",
    AGENT_IDS.geminiPipeline,
    "Review container image vulnerabilities",
    20 * hr,
  ),
  makeSession(
    "sess-sec-006",
    AGENT_IDS.geminiPipeline,
    "License compliance check for new packages",
    28 * hr,
    { type: "schedule_cron" },
  ),
];

const docsBuilderSessions = [
  makeSession(
    "sess-doc-001",
    AGENT_IDS.knowledgeBase,
    "Generate API docs for payments module",
    4 * hr,
  ),
  makeSession(
    "sess-doc-002",
    AGENT_IDS.knowledgeBase,
    "Update REST endpoint reference",
    9 * hr,
  ),
  makeSession(
    "sess-doc-003",
    AGENT_IDS.knowledgeBase,
    "Create onboarding guide for new contributors",
    16 * hr,
  ),
  makeSession(
    "sess-doc-004",
    AGENT_IDS.knowledgeBase,
    "Extract inline JSDoc into markdown pages",
    22 * hr,
    { type: "schedule_cron" },
  ),
  makeSession(
    "sess-doc-005",
    AGENT_IDS.knowledgeBase,
    "Build changelog from merged PRs",
    30 * hr,
  ),
  makeSession(
    "sess-doc-006",
    AGENT_IDS.knowledgeBase,
    "Sync API schema with OpenAPI spec",
    36 * hr,
  ),
  makeSession(
    "sess-doc-007",
    AGENT_IDS.knowledgeBase,
    "Review and fix broken doc links",
    42 * hr,
  ),
];

export const mockSessions: Record<string, unknown[]> = {
  [AGENT_IDS.codexResearch]: ciPipelineSessions,
  [AGENT_IDS.geminiPipeline]: securityScannerSessions,
  [AGENT_IDS.knowledgeBase]: docsBuilderSessions,
};
