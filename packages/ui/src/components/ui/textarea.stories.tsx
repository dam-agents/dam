import type { Meta, StoryObj } from "@storybook/react";

import { Textarea } from "./textarea";

const meta: Meta<typeof Textarea> = {
  title: "Components/Textarea",
  component: Textarea,
  parameters: { layout: "centered" },
};

export default meta;
type Story = StoryObj<typeof Textarea>;

export const Default: Story = {
  args: { placeholder: "Describe what this agent does..." },
};

export const Monospace: Story = {
  args: { variant: "monospace", placeholder: "0 */6 * * *" },
};

export const Invalid: Story = {
  args: { variant: "invalid", defaultValue: "Invalid content" },
};

export const WithContent: Story = {
  name: "With content",
  args: {
    defaultValue:
      "Runs the full CI pipeline including tests, linting, and coverage reports on every push to main.",
  },
};
