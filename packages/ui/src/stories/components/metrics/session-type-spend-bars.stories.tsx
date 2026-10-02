import type { Meta, StoryObj } from "@storybook/react-vite";

import { Card } from "@/components/ui/card";
import { SessionTypeSpendBars } from "@/modules/metrics/components/session-type-spend-bars";
import { useMonthlySpend } from "@/modules/metrics/hooks/use-monthly-spend";

import { inScenario } from "../shared/in-scenario";

/** This month's `metrics.spendBreakdown` rows, as the Usage page passes them. */
function ThisMonth() {
  const { data } = useMonthlySpend();
  return data ? <SessionTypeSpendBars rows={data.bySessionType} /> : null;
}

const meta = {
  title: "Components/Metrics/SessionTypeSpendBars",
  component: SessionTypeSpendBars,
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
} satisfies Meta<typeof SessionTypeSpendBars>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Empty until the fixture backend reports `bySessionType` (it returns [] while
 *  the `session-costs` flag is off). */
export const ThisMonthsSpend: Story = { render: () => <ThisMonth /> };

