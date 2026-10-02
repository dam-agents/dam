import type { Meta, StoryObj } from "@storybook/react-vite";

import { ClampedText } from "@/modules/starter-kits/components/clamped-text";

import { KITS } from "../../backend/fixtures/kits";

const LONG = KITS.find((k) => k.id === "code-guardian")?.description ?? "";

const meta = {
  title: "Components/Starter kits/ClampedText",
  component: ClampedText,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[320px]">
        <Story />
      </div>
    ),
  ],
  args: { text: LONG, className: "text-sm text-muted-foreground" },
} satisfies Meta<typeof ClampedText>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Clamped to two lines; hover for the full text. */
export const TwoLines: Story = {};
export const OneLine: Story = { args: { lines: 1 } };
export const ShortText: Story = {
  args: { text: "Every pull request gets a review, within minutes." },
};
