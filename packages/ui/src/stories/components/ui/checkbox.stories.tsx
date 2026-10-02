import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { Checkbox, CheckboxItem } from "@/components/ui/checkbox";

const SCOPES = [
  {
    scope: "agents:read",
    description:
      "Read-only: list and inspect agents, schedules, skills, and config. No changes, no run.",
  },
  {
    scope: "agents:operate",
    description:
      "Run agents: respond to approvals and upload workspace files. Running can change agent state.",
  },
  {
    scope: "credentials:read",
    description: "List connections and secrets.",
  },
  {
    scope: "credentials:manage",
    description: "Create, update, and delete connections and secrets.",
  },
] as const;

const meta = {
  title: "Components/UI/Checkbox",
  component: Checkbox,
  parameters: { layout: "centered" },
  args: { checked: true, disabled: false, "aria-label": "Select" },
  argTypes: {
    checked: {
      control: "inline-radio",
      options: [true, false, "indeterminate"],
    },
    disabled: { control: "boolean" },
  },
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const States: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Checkbox aria-label="Unchecked" checked={false} />
      <Checkbox aria-label="Checked" checked />
      <Checkbox aria-label="Disabled" disabled />
      <Checkbox aria-label="Checked and disabled" checked disabled />
    </div>
  ),
};

export const Item: StoryObj<typeof CheckboxItem> = {
  render: (args) => <CheckboxItem {...args} />,
  args: {
    label: "agents:read",
    labelClassName: "font-mono font-semibold",
    description: SCOPES[0].description,
    checked: true,
    disabled: false,
    className: "max-w-md",
  },
};

export const ItemDisabled: StoryObj<typeof CheckboxItem> = {
  ...Item,
  args: { ...Item.args, disabled: true, checked: false },
};

export const ScopeList: Story = {
  render: function ScopeList() {
    const [checked, setChecked] = useState<Set<string>>(
      new Set(["agents:read"]),
    );
    return (
      <div className="flex max-w-md flex-col gap-3">
        {SCOPES.map(({ scope, description }) => (
          <CheckboxItem
            key={scope}
            label={scope}
            labelClassName="font-mono font-semibold"
            description={description}
            checked={checked.has(scope)}
            onCheckedChange={(value) =>
              setChecked((prev) => {
                const next = new Set(prev);
                if (value === true) next.add(scope);
                else next.delete(scope);
                return next;
              })
            }
          />
        ))}
      </div>
    );
  },
};
