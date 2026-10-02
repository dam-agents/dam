import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  CHAR_COLORS,
  CHAR_NAMES,
  CharAvatar,
} from "../../../modules/agents/components/char-avatar.js";

const meta = {
  title: "Components/Agents/CharAvatar",
  component: CharAvatar,
  parameters: { layout: "centered" },
  args: { agentId: "demo-agent", state: "running" },
} satisfies Meta<typeof CharAvatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Sleeping: Story = { args: { state: "hibernated" } };

export const Idle: Story = { args: { idle: true } };

export const AllCharacters: Story = {
  render: () => (
    <div className="flex flex-wrap gap-8">
      {CHAR_NAMES.map((name) => (
        <div key={name} className="flex flex-col items-center gap-2">
          <CharAvatar name={name} state="running" colors={CHAR_COLORS[name]} />
          <span className="text-sm text-muted-foreground">{name}</span>
        </div>
      ))}
    </div>
  ),
};

export const AllSleeping: Story = {
  render: () => (
    <div className="flex flex-wrap gap-8">
      {CHAR_NAMES.map((name) => (
        <div key={name} className="flex flex-col items-center gap-2">
          <CharAvatar name={name} state="hibernated" />
          <span className="text-sm text-muted-foreground">{name}</span>
        </div>
      ))}
    </div>
  ),
};
