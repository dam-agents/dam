import { AGENT_IDS } from "./agents.js";

const now = Date.now();
const min = 60_000;

const hr = 60 * min;

export const MOCK_SESSION_IDS = {
  firstLanding: "sess-first-landing",
  conversation: "sess-conversation",
};

export const KIT_SESSION_TO_PACK: Record<string, string> = {};

export const mockSessions: Record<string, unknown[]> = {
  [AGENT_IDS.codexResearch]: [
    {
      sessionId: MOCK_SESSION_IDS.firstLanding,
      agentId: AGENT_IDS.codexResearch,
      type: "regular" as const,
      mode: "chat" as const,
      createdAt: new Date(now - 5 * min).toISOString(),
      updatedAt: new Date(now - 1 * min).toISOString(),
      title: "New conversation",
      running: false,
      seenAt: new Date(now).toISOString(),
    },
    {
      sessionId: MOCK_SESSION_IDS.conversation,
      agentId: AGENT_IDS.codexResearch,
      type: "regular" as const,
      mode: "chat" as const,
      createdAt: new Date(now - 3 * hr).toISOString(),
      updatedAt: new Date(now - 1 * hr).toISOString(),
      title: "Fix empty state in summary component",
      running: false,
      seenAt: new Date(now - 45 * min).toISOString(),
    },
  ],
};
