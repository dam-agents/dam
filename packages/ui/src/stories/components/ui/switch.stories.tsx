import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { useArgs } from "storybook/preview-api";
import { fn } from "storybook/test";

import { Switch } from "@/components/ui/switch";

const meta = {
  title: "Components/UI/Switch",
  component: Switch,
  parameters: { layout: "centered" },
  args: {
    checked: true,
    onCheckedChange: fn(),
    disabled: false,
    label: "Enable schedule",
  },
  argTypes: {
    checked: { control: "boolean" },
    disabled: { control: "boolean" },
    label: { control: "text" },
  },
  render: function Controlled(args) {
    const [, updateArgs] = useArgs<typeof args>();
    return (
      <Switch
        {...args}
        onCheckedChange={(value) => {
          updateArgs({ checked: value });
          args.onCheckedChange(value);
        }}
      />
    );
  },
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const On: Story = {};

export const Off: Story = { args: { checked: false } };

export const Disabled: Story = { args: { disabled: true } };

export const DisabledOff: Story = { args: { disabled: true, checked: false } };

export const WithDescription: Story = {
  args: { label: "Ambient mode", checked: false },
  render: function WithDescription(args) {
    const [checked, setChecked] = useState(args.checked);
    return (
      <div className="flex max-w-md items-start justify-between gap-4 rounded-lg border p-4">
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground">
            Ambient mode
          </span>
          <span className="text-sm text-muted-foreground">
            The agent reads along in the channel and may chime in without being
            mentioned when it can clearly help.
          </span>
        </span>
        <Switch
          {...args}
          className="mt-0.5"
          checked={checked}
          onCheckedChange={setChecked}
        />
      </div>
    );
  },
};
