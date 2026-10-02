import type { Meta, StoryObj } from "@storybook/react-vite";

import { getBrand } from "@/brand";

import { CommandChip } from "../../../modules/agents/components/bind/command-chip.js";

/** The brand is read at render time: it loads after the story modules do. */
const meta = {
  title: "Components/Agents/CommandChip",
  component: CommandChip,
  parameters: { layout: "centered" },
  args: { children: null },
} satisfies Meta<typeof CommandChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SlashCommand: Story = {
  render: () => <CommandChip>/{getBrand().short} unbind triage-bot</CommandChip>,
};

export const Mention: Story = {
  render: () => <CommandChip>@{getBrand().name}</CommandChip>,
};
