import type { Meta, StoryObj } from "@storybook/react-vite";

import { AgentAvatar } from "../../../modules/agents/components/avatar/agent-avatar.js";
import {
  CHAR_COLORS,
  CHAR_NAMES,
  CharAvatar,
} from "../../../modules/agents/components/char-avatar.js";

const meta = {
  title: "Components/Agents/Agent Avatars",
  component: AgentAvatar,
  parameters: { layout: "centered" },
} satisfies Meta<typeof AgentAvatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllCharacters: Story = {
  name: "Running (hover to gesture)",
  render: () => (
    <div className="flex flex-wrap gap-8">
      {CHAR_NAMES.map((name) => (
        <div key={name} className="group flex flex-col items-center gap-3">
          <div className="size-12 flex items-center justify-center">
            <CharAvatar
              name={name}
              state="running"
              colors={CHAR_COLORS[name]}
              className="size-full"
            />
          </div>
          <span className="text-sm text-muted-foreground">{name}</span>
        </div>
      ))}
    </div>
  ),
};

export const AllIdle: Story = {
  name: "Idle (hover to gesture)",
  render: () => (
    <div className="flex flex-wrap gap-8">
      {CHAR_NAMES.map((name) => (
        <div key={name} className="group flex flex-col items-center gap-3">
          <div className="size-12 flex items-center justify-center">
            <CharAvatar
              name={name}
              state="running"
              idle
              colors={CHAR_COLORS[name]}
              className="size-full"
            />
          </div>
          <span className="text-sm text-muted-foreground">{name}</span>
        </div>
      ))}
    </div>
  ),
};

export const AllHibernating: Story = {
  name: "Hibernating (hover to gesture)",
  render: () => (
    <div className="flex flex-wrap gap-8">
      {CHAR_NAMES.map((name) => (
        <div key={name} className="group flex flex-col items-center gap-3">
          <div className="size-12 flex items-center justify-center">
            <CharAvatar name={name} state="hibernated" className="size-full" />
          </div>
          <span className="text-sm text-muted-foreground">{name}</span>
        </div>
      ))}
    </div>
  ),
};
