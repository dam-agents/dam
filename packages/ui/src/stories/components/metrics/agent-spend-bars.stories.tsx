import type { Meta, StoryObj } from "@storybook/react-vite";

import { Card } from "@/components/ui/card";
import { AgentSpendBars } from "@/modules/metrics/components/agent-spend-bars";
import { useMonthlySpend } from "@/modules/metrics/hooks/use-monthly-spend";

import { inScenario } from "../shared/in-scenario";

/** This month's `metrics.spendBreakdown` rows, as the Usage page passes them. */
function ThisMonth() {
  const { data } = useMonthlySpend();
  return data ? <AgentSpendBars rows={data.byAgent} /> : null;
}

const meta = {
  title: "Components/Metrics/AgentSpendBars",
  component: AgentSpendBars,
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
} satisfies Meta<typeof AgentSpendBars>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ThisMonthsSpend: Story = { render: () => <ThisMonth /> };
