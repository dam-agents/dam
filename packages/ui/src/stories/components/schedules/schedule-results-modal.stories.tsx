import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { fn } from "storybook/test";

import { api } from "@/api";
import { ScheduleResultsModal } from "@/modules/schedules/components/schedule-results-modal";

import { IDS } from "../../backend/scenario";

type Args = Omit<
  ComponentProps<typeof ScheduleResultsModal>,
  "agentId" | "schedule"
>;

const loadSchedules = async () => ({
  schedules: await api.schedules.listForOwner.query(),
});
type Loaded = Awaited<ReturnType<typeof loadSchedules>>;

const forAgent = (agentId: string): Story => ({
  render: (args, { loaded }) => {
    const { schedules } = loaded as Loaded;
    const schedule = schedules.find((s) => s.agentId === agentId)!;
    return (
      <ScheduleResultsModal {...args} agentId={agentId} schedule={schedule} />
    );
  },
});

const meta = {
  title: "Components/Schedules/ScheduleResultsModal",
  loaders: [loadSchedules],
  args: { onClose: fn(), onResumeSession: fn() },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<Args>;

export const RunningAgent: Story = forAgent(IDS.codingAgent);
/** The agent is hibernated, so past runs can't be read. */
export const StoppedAgent: Story = forAgent(IDS.hibernatedAgent);
