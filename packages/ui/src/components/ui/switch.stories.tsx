import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import { Switch } from "./switch";

const meta: Meta<typeof Switch> = {
  title: "Components/Switch",
  component: Switch,
  parameters: { layout: "centered" },
};

export default meta;
type Story = StoryObj<typeof Switch>;

function InteractiveSwitch({
  initial = false,
  ...props
}: { initial?: boolean } & Omit<
  React.ComponentProps<typeof Switch>,
  "checked" | "onCheckedChange"
>) {
  const [checked, setChecked] = useState(initial);
  return <Switch checked={checked} onCheckedChange={setChecked} {...props} />;
}

export const Off: Story = {
  render: () => <InteractiveSwitch />,
};

export const On: Story = {
  render: () => <InteractiveSwitch initial />,
};

export const WithLabel: Story = {
  name: "With label",
  render: () => <InteractiveSwitch label="Enable scheduled runs" />,
};

export const Disabled: Story = {
  render: () => <Switch checked={false} onCheckedChange={() => {}} disabled />,
};

export const InContext: Story = {
  name: "In settings context",
  render: () => {
    const [compact, setCompact] = useState(false);
    const [avatars, setAvatars] = useState(true);
    return (
      <div className="flex w-[400px] flex-col gap-6 rounded-lg border border-border p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">Compact mode</p>
            <p className="text-sm text-muted-foreground">
              Reduce spacing in lists and tables.
            </p>
          </div>
          <Switch checked={compact} onCheckedChange={setCompact} />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">
              Show agent avatars
            </p>
            <p className="text-sm text-muted-foreground">
              Display initials badges next to agent names.
            </p>
          </div>
          <Switch checked={avatars} onCheckedChange={setAvatars} />
        </div>
      </div>
    );
  },
};
