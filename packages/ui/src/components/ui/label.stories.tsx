import type { Meta, StoryObj } from "@storybook/react";

import { Label } from "./label";
import { SectionLabel } from "./section-label";

const meta: Meta = {
  title: "Components/Label",
  parameters: { layout: "centered" },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => <Label>FIELD LABEL</Label>,
};

export const SectionLabelDefault: Story = {
  name: "SectionLabel",
  render: () => <SectionLabel>Runtime</SectionLabel>,
};

export const SectionLabelSpaced: Story = {
  name: "SectionLabel (spaced)",
  render: () => <SectionLabel spaced>Agents</SectionLabel>,
};

export const InFormContext: Story = {
  name: "In form context",
  render: () => (
    <div className="flex w-[300px] flex-col gap-6">
      <SectionLabel>Identity</SectionLabel>
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">NAME</Label>
        <input
          id="name"
          className="rounded-lg border border-input bg-background px-3 py-2 text-sm"
          placeholder="my-agent"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="desc">DESCRIPTION</Label>
        <input
          id="desc"
          className="rounded-lg border border-input bg-background px-3 py-2 text-sm"
          placeholder="What does this agent do?"
        />
      </div>
    </div>
  ),
};
