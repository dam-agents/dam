import type { Meta, StoryObj } from "@storybook/react-vite";

import { api } from "@/api";
import { ScheduleDetails } from "@/modules/schedules/components/schedule-details";

import { IDS } from "../../backend/scenario";

const loadSchedules = async () => ({
  schedules: await api.schedules.listForOwner.query(),
});
type Loaded = Awaited<ReturnType<typeof loadSchedules>>;

/** The first fixture schedule belonging to `agentId`. */
const forAgent = (agentId: string): Story => ({
  render: (_args, { loaded }) => {
    const { schedules } = loaded as Loaded;
    const schedule = schedules.find((s) => s.agentId === agentId)!;
    return (
      <div className="max-w-2xl rounded-xl border border-border bg-card">
        <ScheduleDetails schedule={schedule} />
      </div>
    );
  },
});

const meta = {
  title: "Components/Schedules/ScheduleDetails",
  parameters: { layout: "padded" },
  loaders: [loadSchedules],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Active: Story = forAgent(IDS.codingAgent);
/** A disabled schedule shows "Paused" for the next run. */
export const Paused: Story = forAgent(IDS.hibernatedAgent);
