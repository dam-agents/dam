import type { Meta, StoryObj } from "@storybook/react-vite";

import { ReadOnlyOptionFace } from "../../../modules/sessions/components/option-field.js";

/** A disabled select face for a setting that can't be changed right now. */
const meta = {
  title: "Components/Sessions/ReadOnlyOptionFace",
  component: ReadOnlyOptionFace,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[600px]">
        <Story />
      </div>
    ),
  ],
  args: { label: "Unknown", hint: "Start agent to view" },
} satisfies Meta<typeof ReadOnlyOptionFace>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithHint: Story = {};
export const LabelOnly: Story = {
  args: { label: "Claude Sonnet 4.5", hint: undefined },
};
