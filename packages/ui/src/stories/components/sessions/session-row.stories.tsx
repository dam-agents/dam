import type { Meta, StoryObj } from "@storybook/react-vite";
import { SessionMode, SessionType } from "api-server-api";
import { fn } from "storybook/test";

import { SessionRow } from "../../../modules/sessions/components/session-row.js";
import { RUNTIMES } from "../../backend/fixtures/shell";
import { ago, IDS } from "../../backend/scenario";
import { codingAgent, seedAgents, sessionView } from "../agents/story-helpers";

const session = sessionView(IDS.codingAgent, 0);
const slackSession = sessionView(IDS.slackAgent, 0);

/** One row of the chat sidebar's session list. Sessions are the
 *  checkout-service (and triage-bot) fixture sessions. */
const meta = {
  title: "Components/Sessions/SessionRow",
  component: SessionRow,
  loaders: [seedAgents()],
  decorators: [
    (Story) => (
      <div className="w-[280px] border-r border-border">
        <Story />
      </div>
    ),
  ],
  args: {
    session,
    active: false,
    working: false,
    needsApproval: false,
    onResume: fn(),
    onDelete: fn(),
  },
} satisfies Meta<typeof SessionRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {};
export const Active: Story = { args: { active: true } };
export const Unread: Story = { args: { unread: true } };
export const Working: Story = { args: { working: true } };
export const NeedsApproval: Story = { args: { needsApproval: true } };
export const HasDraft: Story = { args: { draft: true } };

export const BackgroundWork: Story = {
  args: {
    backgroundWork: [
      {
        id: "bash_1",
        description: "Watch the test suite",
        command: "pnpm vitest --watch",
      },
    ],
  },
};

/** With the "session-costs" flag the list shows each session's spend. */
export const WithCost: Story = {
  args: {
    cost: RUNTIMES.find((r) => r.row.sessionId === IDS.session1)?.row,
  },
};

export const SlackThread: Story = {
  args: { session: slackSession, conversation: "#help-platform" },
};

export const SlackThreadWorking: Story = {
  args: { ...SlackThread.args, working: true },
};

export const Terminal: Story = {
  args: {
    session: sessionView(IDS.codingAgent, 1, {
      mode: SessionMode.Terminal,
      title: "pnpm test --watch",
    }),
  },
};

/** A run of the fixture "Dependency audit" schedule. */
export const Scheduled: Story = {
  args: {
    session: sessionView(IDS.codingAgent, 2, {
      type: SessionType.ScheduleCron,
      scheduleId: "sched-4a7e21b1",
      title: "Dependency audit",
      runCount: 3,
      runTotalMs: 544_000,
    }),
  },
};

export const ScheduledRunningNow: Story = {
  args: {
    session: sessionView(IDS.codingAgent, 2, {
      type: SessionType.ScheduleCron,
      scheduleId: "sched-4a7e21b1",
      title: "Dependency audit",
      runStartedAt: ago(2),
      runCount: 3,
      runTotalMs: 544_000,
    }),
    working: true,
  },
};

export const Untitled: Story = {
  args: { session: sessionView(IDS.codingAgent, 0, { title: null }) },
};

/** The first session of an agent created from a starter kit. */
export const Onboarding: Story = {
  loaders: [
    seedAgents([
      codingAgent({ starterKit: `${IDS.kitCatalog}/${IDS.kit}@1.2.0` }),
    ]),
  ],
  args: {
    session: sessionView(IDS.codingAgent, 0, {
      initialization: true,
      title: "Set up Code Guardian",
    }),
  },
};
