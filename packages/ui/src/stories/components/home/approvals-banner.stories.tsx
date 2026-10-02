import type { Meta, StoryObj } from "@storybook/react-vite";

import { ApprovalsBanner } from "@/modules/home/components/approvals-banner";

import { inScenario } from "../shared/in-scenario";

/** Counts the pending approvals from `approvals.listForOwner`. */
const meta = {
  title: "Components/Home/ApprovalsBanner",
  component: ApprovalsBanner,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[880px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ApprovalsBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Waiting: Story = { decorators: [inScenario("populated")] };

/** No pending approvals: renders nothing. */
export const NoneWaiting: Story = { decorators: [inScenario("empty")] };
