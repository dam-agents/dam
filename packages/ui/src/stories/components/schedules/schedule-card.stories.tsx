import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { fn } from "storybook/test";

import { api } from "@/api";
import { ScheduleCard } from "@/modules/schedules/components/schedule-card";

import { IDS } from "../../backend/scenario";

/** `schedule` comes from the fake backend (loader), not from args. */
type Args = Omit<ComponentProps<typeof ScheduleCard>, "schedule">;

const loadSchedules = async () => ({
  schedules: await api.schedules.list.query({ agentId: IDS.codingAgent }),
});
type Loaded = Awaited<ReturnType<typeof loadSchedules>>;

const meta = {
  title: "Components/Schedules/ScheduleCard",
  parameters: { layout: "padded" },
  loaders: [loadSchedules],
  args: {
    isExpanded: false,
    onToggleExpanded: fn(),
    onEdit: fn(),
    onViewResults: fn(),
  },
  render: (args, { loaded }) => {
    const { schedules } = loaded as Loaded;
    return (
      <div className="max-w-2xl">
        <ScheduleCard {...args} schedule={schedules[0]} />
      </div>
    );
  },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Collapsed: Story = {};
export const Expanded: Story = { args: { isExpanded: true } };
