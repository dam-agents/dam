import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";

import { ToolChip } from "../../../modules/sessions/components/tool-chip.js";
import { COMPLETED_CHIP, FAILED_CHIP } from "./chat-fixtures";

/** One tool call in an agent reply. Chips come from the checkout-service
 *  fixture transcript; click the title to show the output. The copy button
 *  appears on hover. */
const meta = {
  title: "Components/Sessions/ToolChip",
  component: ToolChip,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[813px]">
        <Story />
      </div>
    ),
  ],
  args: { chip: COMPLETED_CHIP },
} satisfies Meta<typeof ToolChip>;

export default meta;
type Story = StoryObj<typeof meta>;

const expand = async ({ canvasElement }: { canvasElement: HTMLElement }) => {
  await userEvent.click(
    within(canvasElement).getAllByRole("button", { expanded: false })[0]!,
  );
};

export const Pending: Story = {
  args: { chip: { ...COMPLETED_CHIP, status: "pending", content: undefined } },
};

export const InProgress: Story = {
  args: {
    chip: { ...COMPLETED_CHIP, status: "in_progress", content: undefined },
  },
};

export const Completed: Story = {};

export const CompletedExpanded: Story = { play: expand };

export const Failed: Story = { args: { chip: FAILED_CHIP } };

export const FailedExpanded: Story = {
  args: { chip: FAILED_CHIP },
  play: expand,
};

export const LongTitle: Story = {
  args: {
    chip: {
      ...COMPLETED_CHIP,
      title: `${COMPLETED_CHIP.title} ${"--reporter=verbose ".repeat(12)}`,
    },
  },
};
