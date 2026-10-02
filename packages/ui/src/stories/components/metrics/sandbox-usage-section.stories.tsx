import type { Meta, StoryObj } from "@storybook/react-vite";

import { SandboxUsageSection } from "@/modules/metrics/components/sandbox-usage-section";

import { IDS } from "../../backend/scenario";
import { inScenario } from "../shared/in-scenario";

/** The Usage block on an agent's page, fed by `metrics.spendBreakdown`. */
const meta = {
  title: "Components/Metrics/SandboxUsageSection",
  component: SandboxUsageSection,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[880px]">
        <Story />
      </div>
    ),
  ],
  args: { agentId: IDS.codingAgent },
} satisfies Meta<typeof SandboxUsageSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithSpend: Story = { decorators: [inScenario("populated")] };
export const OtherAgent: Story = {
  args: { agentId: IDS.slackAgent },
  decorators: [inScenario("populated")],
};
/** No LLM calls this month. */
export const NoCalls: Story = { decorators: [inScenario("empty")] };
