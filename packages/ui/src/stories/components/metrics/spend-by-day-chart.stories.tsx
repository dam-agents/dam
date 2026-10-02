import type { Meta, StoryObj } from "@storybook/react-vite";

import { Card } from "@/components/ui/card";
import { SpendByDayChart } from "@/modules/metrics/components/spend-by-day-chart";
import { useMonthlySpend } from "@/modules/metrics/hooks/use-monthly-spend";
import { fillMonthDays, monthRange } from "@/modules/metrics/lib/month-range";

import { inScenario } from "../shared/in-scenario";

/** This month's daily spend, gap-filled the way the Usage page does it. */
function ThisMonth() {
  const { data, shownMonth } = useMonthlySpend();
  if (!data) return null;
  return (
    <SpendByDayChart
      days={fillMonthDays(
        shownMonth,
        monthRange(shownMonth).isCurrentMonth,
        data.byDay,
      )}
    />
  );
}

const meta = {
  title: "Components/Metrics/SpendByDayChart",
  component: SpendByDayChart,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <Card className="max-w-[880px] p-5">
        <Story />
      </Card>
    ),
    inScenario("populated"),
  ],
  args: { days: [] },
} satisfies Meta<typeof SpendByDayChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ThisMonthsSpend: Story = { render: () => <ThisMonth /> };

/** A month with no calls: flat axis, no bars. */
export const NoSpend: Story = {
  render: function Render() {
    const { shownMonth } = useMonthlySpend();
    return <SpendByDayChart days={fillMonthDays(shownMonth, false, [])} />;
  },
};
