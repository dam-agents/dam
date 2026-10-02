import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  AlwaysOnTag,
  stateDotClass,
  StatusBadge,
} from "@/components/status-indicator";
import type { AgentDisplayState } from "@/modules/agents/utils/agent-resolver";

const STATES = Object.keys(stateDotClass) as AgentDisplayState[];

const meta = {
  title: "Components/Shared/StatusIndicator",
  component: StatusBadge,
  parameters: { layout: "padded" },
  argTypes: { state: { control: "select", options: STATES } },
  args: { state: "running" },
} satisfies Meta<typeof StatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = {};
export const Working: Story = { args: { working: true } };
export const Idle: Story = { args: { working: false } };
export const Starting: Story = { args: { state: "starting" } };
export const PreparingWorkspace: Story = {
  args: { state: "preparing_workspace" },
};
export const Hibernating: Story = { args: { state: "hibernating" } };
export const Hibernated: Story = { args: { state: "hibernated" } };
export const Error: Story = { args: { state: "error" } };
export const OverBudget: Story = { args: { state: "over_budget" } };
export const Migrating: Story = { args: { state: "migrating" } };

/** Every agent display state. */
export const AllStates: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {STATES.map((state) => (
        <div key={state} className="flex items-center gap-3">
          <StatusBadge state={state} />
          <span className="font-mono text-sm text-muted-foreground">
            {state}
          </span>
        </div>
      ))}
      <div className="flex items-center gap-3">
        <StatusBadge state="running" working />
        <StatusBadge state="running" working={false} />
        <span className="font-mono text-sm text-muted-foreground">
          running, split by working
        </span>
      </div>
    </div>
  ),
};

export const AlwaysOn: Story = { render: () => <AlwaysOnTag /> };
