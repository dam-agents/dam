import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  readFailureMessage,
  UsageNotice,
  UsageStaleLabel,
} from "@/modules/metrics/components/usage-notice";

const meta = {
  title: "Components/Metrics/UsageNotice",
  component: UsageNotice,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[880px]">
        <Story />
      </div>
    ),
  ],
  args: { children: "No LLM calls in September 2026." },
} satisfies Meta<typeof UsageNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoCalls: Story = {};
export const LoadFailed: Story = {
  args: { children: readFailureMessage(false, "September 2026") },
};
export const Unavailable: Story = {
  args: { children: readFailureMessage(true, "September 2026") },
};

/** The small label beside the month switcher while data refreshes. */
export const StaleLabels: Story = {
  render: () => (
    <div className="flex items-center gap-6">
      <UsageStaleLabel freshness="updating" />
      <UsageStaleLabel freshness="failed" />
      <span className="text-sm text-muted-foreground">
        (fresh renders nothing)
      </span>
      <UsageStaleLabel freshness="fresh" />
    </div>
  ),
};
