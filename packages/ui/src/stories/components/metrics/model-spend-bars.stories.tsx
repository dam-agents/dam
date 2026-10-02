import type { Meta, StoryObj } from "@storybook/react-vite";

import { Card } from "@/components/ui/card";
import { ModelSpendBars } from "@/modules/metrics/components/model-spend-bars";
import { useMonthlySpend } from "@/modules/metrics/hooks/use-monthly-spend";

import { IDS } from "../../backend/scenario";
import { inScenario } from "../shared/in-scenario";

/** This month's `metrics.spendBreakdown` rows, as the Usage page passes them. */
function ThisMonth({ agentId }: { agentId?: string }) {
  const { data } = useMonthlySpend(agentId);
  return data ? <ModelSpendBars rows={data.byModel} /> : null;
}

const meta = {
  title: "Components/Metrics/ModelSpendBars",
  component: ModelSpendBars,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <Card className="max-w-[720px] p-5">
        <Story />
      </Card>
    ),
    inScenario("populated"),
  ],
  args: { rows: [] },
} satisfies Meta<typeof ModelSpendBars>;

export default meta;
type Story = StoryObj<typeof meta>;

/** All agents. Captions show tokens in → out. */
export const AllAgents: Story = { render: () => <ThisMonth /> };

/** One agent, as on its sandbox page. */
export const OneAgent: Story = {
  render: () => <ThisMonth agentId={IDS.codingAgent} />,
};
