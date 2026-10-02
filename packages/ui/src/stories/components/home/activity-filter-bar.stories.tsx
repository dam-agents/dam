import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { ActivityFilterBar } from "@/modules/home/components/activity-filter-bar";
import {
  type ActivityFilters,
  type ChannelType,
  defaultActivityFilters,
  isFiltered,
} from "@/modules/home/lib/activity-filter";

function Stateful({ initial }: { initial: ActivityFilters }) {
  const [filters, setFilters] = useState(initial);
  return (
    <ActivityFilterBar
      filters={filters}
      filtered={isFiltered(filters)}
      onToggleChannelType={(type) =>
        setFilters((prev) => {
          const next = new Set(prev.channelTypes);
          if (next.has(type)) next.delete(type);
          else next.add(type);
          return { ...prev, channelTypes: next };
        })
      }
      onChangeState={(state) => setFilters((prev) => ({ ...prev, state }))}
      onReset={() => setFilters(defaultActivityFilters())}
    />
  );
}

const meta = {
  title: "Components/Home/ActivityFilterBar",
  component: ActivityFilterBar,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[480px]">
        <Story />
      </div>
    ),
  ],
  args: {
    filters: defaultActivityFilters(),
    filtered: false,
    onToggleChannelType: () => {},
    onChangeState: () => {},
    onReset: () => {},
  },
} satisfies Meta<typeof ActivityFilterBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** All types, any status: no reset link. */
export const Default: Story = {
  render: () => <Stateful initial={defaultActivityFilters()} />,
};

/** A narrowed filter shows "Reset to default". */
export const Filtered: Story = {
  render: () => (
    <Stateful
      initial={{
        channelTypes: new Set<ChannelType>(["slack", "schedule"]),
        state: "unread",
      }}
    />
  ),
};

export const NoTypes: Story = {
  render: () => (
    <Stateful initial={{ channelTypes: new Set(), state: "in-progress" }} />
  ),
};
