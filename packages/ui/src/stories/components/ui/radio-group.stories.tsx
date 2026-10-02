import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";

import { Input } from "@/components/ui/input";
import {
  RadioGroup,
  RadioGroupCard,
  RadioGroupItem,
} from "@/components/ui/radio-group";

const VISIBILITY = [
  { value: "private", label: "Private", description: "Only you" },
  {
    value: "restricted",
    label: "Restricted",
    description: "Only invited people",
  },
  { value: "public", label: "Public", description: "Anyone with the link" },
] as const;

const ROW = "rounded-lg p-2 enabled:cursor-pointer enabled:hover:bg-muted/40";

const meta = {
  title: "Components/UI/RadioGroup",
  component: RadioGroup,
  parameters: { layout: "padded" },
  args: {
    defaultValue: "restricted",
    disabled: false,
    onValueChange: fn(),
    "aria-label": "Who can open this artifact",
    className: "max-w-md",
  },
  argTypes: {
    disabled: { control: "boolean" },
    orientation: {
      control: "inline-radio",
      options: ["vertical", "horizontal"],
    },
  },
  render: (args) => (
    <RadioGroup {...args}>
      {VISIBILITY.map((option) => (
        <RadioGroupItem
          key={option.value}
          value={option.value}
          label={option.label}
          description={option.description}
          className={ROW}
        />
      ))}
    </RadioGroup>
  ),
} satisfies Meta<typeof RadioGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Items: Story = {};

export const WithDisabledItem: Story = {
  args: { defaultValue: "all", "aria-label": "Agents" },
  render: (args) => (
    <RadioGroup {...args}>
      <RadioGroupItem
        value="all"
        label="All agents"
        description="Every agent you own, now and in the future."
        className={ROW}
      />
      <RadioGroupItem
        value="specific"
        label="Specific agents"
        description="Only the agents you pick below."
        disabled
        className={ROW}
      />
    </RadioGroup>
  ),
};

export const LabelOnly: Story = {
  args: {
    defaultValue: "read",
    "aria-label": "Contents",
    className: "flex-row gap-6",
  },
  render: (args) => (
    <RadioGroup {...args}>
      <RadioGroupItem value="off" label="Off" className="w-auto" />
      <RadioGroupItem value="read" label="Read" className="w-auto" />
      <RadioGroupItem value="write" label="Write" className="w-auto" />
    </RadioGroup>
  ),
};

export const Cards: Story = {
  render: function Cards(args) {
    const [value, setValue] = useState("github-pat");
    const options = [
      {
        value: "github",
        label: "GitHub",
        description: "Read + write GitHub repos, issues, PRs.",
      },
      {
        value: "github-pat",
        label: "GitHub (Personal Access Token)",
        description:
          "Read + write GitHub repos, issues, PRs with a personal access token.",
      },
      {
        value: "github-app",
        label: "GitHub App (installation)",
        description:
          "Act as a GitHub App installation. The platform mints short-lived installation tokens (ghs_…) from the app's private key.",
      },
    ];
    return (
      <RadioGroup
        {...args}
        value={value}
        onValueChange={setValue}
        className="max-w-xl gap-4"
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <RadioGroupCard
              key={option.value}
              value={option.value}
              label={option.label}
              description={selected ? option.description : undefined}
            >
              {selected ? <Input placeholder="ghp_…" /> : null}
            </RadioGroupCard>
          );
        })}
      </RadioGroup>
    );
  },
};
