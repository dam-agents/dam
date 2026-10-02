import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { useBudgetReserved } from "@/modules/budgets/api/queries";
import { SlotBar } from "@/modules/budgets/components/slot-bar";
import {
  computeView,
  formatSizeLabel,
  slotUnitOf,
} from "@/modules/budgets/lib/slots";
import { useFeed } from "@/modules/home/api/queries";

import { inScenario } from "../shared/in-scenario";

/** Segments built by `computeView` from the fixture agents and budget, as
 *  ComputeUsage builds them. */
function FixtureSlots({ withContent }: { withContent?: boolean }) {
  const { data: budget } = useBudgetReserved();
  const { agents, workingAgentIds } = useFeed();
  if (!budget) return null;
  const unit = slotUnitOf(budget);
  const view = computeView(
    agents.filter((a) => a.state === "running"),
    workingAgentIds,
    budget,
  );
  return (
    <SlotBar
      segments={view.segments}
      totalSlots={view.totalSlots}
      label={(s) =>
        s.state === "available"
          ? `${s.slots} ${s.slots === 1 ? "slot" : "slots"} available`
          : `${s.agentName} · ${formatSizeLabel(s, unit)}`
      }
      content={
        withContent
          ? (s) => (
              <p className="text-foreground">
                <span className="font-semibold">{s.agentName}</span> ·{" "}
                {formatSizeLabel(s, unit)}
              </p>
            )
          : undefined
      }
      onActivate={fn()}
      ariaLabel="Usage slots"
    />
  );
}

const meta = {
  title: "Components/Budgets/SlotBar",
  component: SlotBar,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[440px]">
        <Story />
      </div>
    ),
    inScenario("populated"),
  ],
  args: {
    segments: [],
    totalSlots: 0,
    label: () => "",
    ariaLabel: "Usage slots",
  },
} satisfies Meta<typeof SlotBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Hover a segment: the tooltip shows its label. */
export const LabelTooltips: Story = { render: () => <FixtureSlots /> };

/** With `content`, held segments open a richer card on hover. */
export const ContentCards: Story = {
  render: () => <FixtureSlots withContent />,
};
