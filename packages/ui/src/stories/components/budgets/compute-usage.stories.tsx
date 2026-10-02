import type { Meta, StoryObj } from "@storybook/react-vite";

import { ComputeUsage } from "@/modules/budgets/components/compute-usage";
import { useFeed } from "@/modules/home/api/queries";

import { inScenario } from "../shared/in-scenario";

/** Home passes the live agent list and the feed's working set. */
function HomeCompute() {
  const { agents, workingAgentIds } = useFeed();
  return <ComputeUsage agents={agents} workingAgentIds={workingAgentIds} />;
}

/** Reads `budgets.reserved` and `links.all` from the fixtures. */
const meta = {
  title: "Components/Budgets/ComputeUsage",
  component: ComputeUsage,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[440px] rounded-2xl border border-border bg-card p-6">
        <Story />
      </div>
    ),
  ],
  args: { agents: [], workingAgentIds: new Set() },
} satisfies Meta<typeof ComputeUsage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Running agents holding slots; hover a segment for details. */
export const Allocated: Story = {
  decorators: [inScenario("populated")],
  render: () => <HomeCompute />,
};

export const NothingHeld: Story = {
  decorators: [inScenario("empty")],
  render: () => <HomeCompute />,
};
