import type { Meta, StoryObj } from "@storybook/react-vite";

import { SpendWidget } from "@/modules/home/components/spend-widget";

import { inScenario } from "../shared/in-scenario";

/** Reads `metrics.spendBreakdown`; the period toggle refetches. */
const meta = {
  title: "Components/Home/SpendWidget",
  component: SpendWidget,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[440px]">
        <Story />
      </div>
    ),
    inScenario("populated"),
  ],
} satisfies Meta<typeof SpendWidget>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TopSpenders: Story = { decorators: [inScenario("populated")] };
export const NoSpend: Story = { decorators: [inScenario("empty")] };
