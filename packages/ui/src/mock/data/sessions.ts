import type { SessionView } from "api-server-api";
import { SessionMode, SessionType } from "api-server-api";

import { AGENT_IDS } from "./agents.js";

const now = Date.now();
const min = 60_000;
const hour = 60 * min;
const day = 24 * hour;

function ts(msAgo: number): string {
  return new Date(now - msAgo).toISOString();
}

function seenBefore(updatedAt: string, offsetMs = 10 * min): string {
  return new Date(Date.parse(updatedAt) - offsetMs).toISOString();
}

const SCHED_LINKCHECK = "sched-linkcheck";
const SCHED_WEEKLY = "sched-weekly-digest";
const EXP_PROMPT_SWEEP = "exp-prompt-sweep";

const todaySessions: SessionView[] = [
  // 7 schedule runs of sched-linkcheck, all same title
  ...[6, 21, 39, 64, 88, 111, 134].map(
    (m, i): SessionView => ({
      sessionId: `sched-run-${i + 1}`,
      agentId: AGENT_IDS.docsReviewer,
      type: SessionType.ScheduleCron,
      mode: SessionMode.Chat,
      createdAt: ts(m * min + 5 * min),
      updatedAt: ts(m * min),
      seenAt: seenBefore(ts(m * min)),
      title:
        "Sweep the docs site for broken links and open an issue for each one",
      scheduleId: SCHED_LINKCHECK,
      running: false,
    }),
  ),

  // Chat, 4 min ago — metrics-helper
  {
    sessionId: "chat-metrics",
    agentId: AGENT_IDS.metricsHelper,
    type: SessionType.Regular,
    mode: SessionMode.Chat,
    createdAt: ts(10 * min),
    updatedAt: ts(4 * min),
    seenAt: seenBefore(ts(4 * min)),
    title:
      "Have a look at Q3-metrics-final.xlsx and tell me which regions missed target",
    running: false,
  },

  // Chat, 47 min ago, RUNNING — docs-reviewer
  {
    sessionId: "chat-flaky-test",
    agentId: AGENT_IDS.docsReviewer,
    type: SessionType.Regular,
    mode: SessionMode.Chat,
    createdAt: ts(55 * min),
    updatedAt: ts(47 * min),
    seenAt: seenBefore(ts(47 * min)),
    title: "Fix the flaky upload test",
    running: true,
  },

  // Slack, 33 min ago — docs-reviewer
  {
    sessionId: "slack-quickstart",
    agentId: AGENT_IDS.docsReviewer,
    type: SessionType.ChannelSlack,
    mode: SessionMode.Chat,
    createdAt: ts(40 * min),
    updatedAt: ts(33 * min),
    seenAt: seenBefore(ts(33 * min)),
    title:
      "Can you check whether the docs site is still linking to the old quickstart?",
    threadTs: "C01234:1724680000.000001",
    running: false,
  },

  // Experiment run, 72 min ago — release-notes
  {
    sessionId: "exp-run-12",
    agentId: AGENT_IDS.releaseNotes,
    type: SessionType.ExperimentExecute,
    mode: SessionMode.Chat,
    createdAt: ts(80 * min),
    updatedAt: ts(72 * min),
    seenAt: seenBefore(ts(72 * min)),
    title: "prompt-sweep run 12 — temperature 0.7",
    experimentId: EXP_PROMPT_SWEEP,
    running: false,
  },
];

const yesterdaySessions: SessionView[] = [
  // Chat — release-notes
  {
    sessionId: "chat-release-note",
    agentId: AGENT_IDS.releaseNotes,
    type: SessionType.Regular,
    mode: SessionMode.Chat,
    createdAt: ts(day + 4 * hour),
    updatedAt: ts(day + 2 * hour),
    seenAt: seenBefore(ts(day + 2 * hour)),
    title: "Draft the release note for 0.2.16",
    running: false,
  },

  // Slack — docs-reviewer
  {
    sessionId: "slack-old-flag",
    agentId: AGENT_IDS.docsReviewer,
    type: SessionType.ChannelSlack,
    mode: SessionMode.Chat,
    createdAt: ts(day + 1 * hour),
    updatedAt: ts(day),
    seenAt: seenBefore(ts(day)),
    title: "Is the quickstart page still pointing at the old CLI flag?",
    threadTs: "C01234:1724590000.000001",
    running: false,
  },
];

const lastWeekSessions: SessionView[] = [
  // Experiment run — release-notes
  {
    sessionId: "exp-run-9",
    agentId: AGENT_IDS.releaseNotes,
    type: SessionType.ExperimentExecute,
    mode: SessionMode.Chat,
    createdAt: ts(4 * day + 3 * hour),
    updatedAt: ts(4 * day + 2 * hour),
    seenAt: seenBefore(ts(4 * day + 2 * hour)),
    title: "prompt-sweep run 9 — temperature 0.4",
    experimentId: EXP_PROMPT_SWEEP,
    running: false,
  },

  // Chat — metrics-helper
  {
    sessionId: "chat-error-copy",
    agentId: AGENT_IDS.metricsHelper,
    type: SessionType.Regular,
    mode: SessionMode.Chat,
    createdAt: ts(5 * day + 2 * hour),
    updatedAt: ts(5 * day + 1 * hour),
    seenAt: seenBefore(ts(5 * day + 1 * hour)),
    title: "Rewrite the connection error copy",
    running: false,
  },
];

const lastMonthSessions: SessionView[] = [
  // One schedule run of sched-weekly-digest — must render as plain card, not group
  {
    sessionId: "sched-digest-1",
    agentId: AGENT_IDS.releaseNotes,
    type: SessionType.ScheduleCron,
    mode: SessionMode.Chat,
    createdAt: ts(21 * day + 3 * hour),
    updatedAt: ts(21 * day + 2 * hour),
    seenAt: seenBefore(ts(21 * day + 2 * hour)),
    title: "Post the weekly usage digest",
    scheduleId: SCHED_WEEKLY,
    running: false,
  },
];

const allSessions = [
  ...todaySessions,
  ...yesterdaySessions,
  ...lastWeekSessions,
  ...lastMonthSessions,
];

export function getSessionsForAgent(agentId: string): SessionView[] {
  return allSessions.filter((s) => s.agentId === agentId);
}

export { allSessions as sessions };
