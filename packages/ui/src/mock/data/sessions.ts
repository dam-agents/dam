import { AGENT_IDS } from "./agents.js";

interface MockPodSession {
  sessionId: string;
  mode: "chat" | "terminal";
  type:
    | "regular"
    | "channel_slack"
    | "channel_telegram"
    | "schedule_cron"
    | "experiment_execute";
  createdAt: string;
  updatedAt: string | null;
  title: string | null;
  scheduleId: string | null;
  experimentId: string | null;
  threadTs: string | null;
  seenAt: string | null;
  running: boolean;
  channelName?: string | null;
}

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3_600_000).toISOString();
}

const shared: Pick<
  MockPodSession,
  "scheduleId" | "experimentId" | "seenAt"
> = {
  scheduleId: null,
  experimentId: null,
  seenAt: null,
};

export const agentSessions: Record<string, MockPodSession[]> = {
  [AGENT_IDS.codexResearch]: [
    {
      ...shared,
      sessionId: "sess-codex-01",
      mode: "chat",
      type: "regular",
      createdAt: hoursAgo(1),
      updatedAt: hoursAgo(0.5),
      title: "Generate hero banner variants",
      threadTs: null,
      running: true,
    },
    {
      ...shared,
      sessionId: "sess-codex-02",
      mode: "chat",
      type: "channel_slack",
      createdAt: hoursAgo(3),
      updatedAt: hoursAgo(1),
      title: "#design-reviews",
      threadTs: "ambient:C04DESIGN",
      channelName: "#design-reviews",
      running: false,
    },
    {
      ...shared,
      sessionId: "sess-codex-03",
      mode: "chat",
      type: "channel_slack",
      createdAt: hoursAgo(6),
      updatedAt: hoursAgo(2),
      title: "Logo refresh feedback",
      threadTs: "C04DESIGN:1717200000.000100",
      channelName: "#design-reviews",
      running: false,
    },
    {
      ...shared,
      sessionId: "sess-codex-04",
      mode: "chat",
      type: "regular",
      createdAt: hoursAgo(24),
      updatedAt: hoursAgo(12),
      title: "Social media templates",
      threadTs: null,
      running: false,
    },
    {
      ...shared,
      sessionId: "sess-codex-05",
      mode: "chat",
      type: "channel_telegram",
      createdAt: hoursAgo(4),
      updatedAt: hoursAgo(2.5),
      title: "DAM Design Group",
      threadTs: null,
      channelName: "DAM Design Group",
      running: false,
    },
  ],

  [AGENT_IDS.claudeCodeMain]: [
    {
      ...shared,
      sessionId: "sess-claude-01",
      mode: "chat",
      type: "channel_slack",
      createdAt: hoursAgo(0.5),
      updatedAt: hoursAgo(0.1),
      title: "#packaging-ops",
      threadTs: "ambient:C05PACKAGING",
      channelName: "#packaging-ops",
      running: true,
    },
    {
      ...shared,
      sessionId: "sess-claude-02",
      mode: "chat",
      type: "channel_slack",
      createdAt: hoursAgo(2),
      updatedAt: hoursAgo(0.8),
      title: "Print spec dimensions",
      threadTs: "C05PACKAGING:1717210000.000200",
      channelName: "#packaging-ops",
      running: false,
    },
    {
      ...shared,
      sessionId: "sess-claude-03",
      mode: "chat",
      type: "regular",
      createdAt: hoursAgo(8),
      updatedAt: hoursAgo(4),
      title: "Box template adjustments",
      threadTs: null,
      running: false,
    },
    {
      ...shared,
      sessionId: "sess-claude-04",
      mode: "chat",
      type: "channel_slack",
      createdAt: hoursAgo(12),
      updatedAt: hoursAgo(6),
      title: "DM with @sarah",
      threadTs: "D08SARAH:1717180000.000300",
      channelName: "DM with @sarah",
      running: false,
    },
    {
      ...shared,
      sessionId: "sess-claude-05",
      mode: "chat",
      type: "regular",
      createdAt: hoursAgo(48),
      updatedAt: hoursAgo(36),
      title: "Label layout for EU market",
      threadTs: null,
      running: false,
    },
    {
      ...shared,
      sessionId: "sess-claude-06",
      mode: "terminal",
      type: "regular",
      createdAt: hoursAgo(10),
      updatedAt: hoursAgo(5),
      title: "Build preview assets",
      threadTs: null,
      running: false,
    },
  ],

  [AGENT_IDS.geminiPipeline]: [
    {
      ...shared,
      sessionId: "sess-gemini-01",
      mode: "chat",
      type: "regular",
      createdAt: hoursAgo(2),
      updatedAt: hoursAgo(0.5),
      title: "Batch color correction — summer collection",
      threadTs: null,
      running: true,
    },
    {
      ...shared,
      sessionId: "sess-gemini-02",
      mode: "chat",
      type: "regular",
      createdAt: hoursAgo(18),
      updatedAt: hoursAgo(14),
      title: "Background removal — product shots",
      threadTs: null,
      running: false,
    },
    {
      ...shared,
      sessionId: "sess-gemini-03",
      mode: "chat",
      type: "channel_telegram",
      createdAt: hoursAgo(5),
      updatedAt: hoursAgo(3),
      title: "Photo Team Chat",
      threadTs: null,
      channelName: "Photo Team Chat",
      running: false,
    },
  ],

  [AGENT_IDS.cacheTuning]: [
    {
      ...shared,
      sessionId: "sess-cache-01",
      mode: "chat",
      type: "channel_slack",
      createdAt: hoursAgo(1),
      updatedAt: hoursAgo(0.3),
      title: "#infra-cache",
      threadTs: "ambient:C03CACHE",
      channelName: "#infra-cache",
      running: true,
    },
    {
      ...shared,
      sessionId: "sess-cache-02",
      mode: "chat",
      type: "channel_slack",
      createdAt: hoursAgo(4),
      updatedAt: hoursAgo(1.5),
      title: "Eviction policy for asset CDN",
      threadTs: "C03CACHE:1717195000.000400",
      channelName: "#infra-cache",
      running: false,
    },
    {
      ...shared,
      sessionId: "sess-cache-03",
      mode: "chat",
      type: "regular",
      createdAt: hoursAgo(7),
      updatedAt: hoursAgo(3),
      title: "Analyze hit/miss ratios",
      threadTs: null,
      running: false,
    },
    {
      ...shared,
      sessionId: "sess-cache-04",
      mode: "chat",
      type: "regular",
      createdAt: hoursAgo(30),
      updatedAt: hoursAgo(24),
      title: "Initial cache profile",
      threadTs: null,
      running: false,
    },
  ],
};
