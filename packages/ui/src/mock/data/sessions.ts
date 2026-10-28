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
  envMockup: "sess-env-mockup",
};

export const KIT_SESSION_TO_PACK: Record<string, string> = {};

const ciPipelineSessions = [
  makeSession(
    MOCK_SESSION_IDS.artifact,
    AGENT_IDS.codexResearch,
    "Artifact session",
    15 * min,
    { unread: true },
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
    MOCK_SESSION_IDS.envMockup,
    AGENT_IDS.codexResearch,
    "Environment session",
    30 * min,
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
    "Slack Session",
    18 * hr,
    { type: "channel_slack", slackChannel: "deployments" },
  ),
];

export const mockSessions: Record<string, unknown[]> = {
  [AGENT_IDS.codexResearch]: ciPipelineSessions,
};
