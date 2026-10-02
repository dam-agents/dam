import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { MonthSwitcher } from "@/modules/metrics/components/month-switcher";
import { monthRange, monthStart } from "@/modules/metrics/lib/month-range";

import { NOW } from "../../backend/scenario";

function Stateful({ offset }: { offset: number }) {
  const [month, setMonth] = useState(() => monthStart(new Date(NOW), offset));
  return (
    <MonthSwitcher
      month={month}
      isCurrentMonth={monthRange(month).isCurrentMonth}
      onChange={setMonth}
    />
  );
}

const meta = {
  title: "Components/Metrics/MonthSwitcher",
  component: MonthSwitcher,
  parameters: { layout: "centered" },
  args: {
    month: monthStart(new Date(NOW), 0),
    isCurrentMonth: true,
    onChange: () => {},
  },
} satisfies Meta<typeof MonthSwitcher>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The current month: "next" is disabled. */
export const CurrentMonth: Story = { render: () => <Stateful offset={0} /> };
export const EarlierMonth: Story = { render: () => <Stateful offset={-2} /> };
