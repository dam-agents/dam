import type { Meta, StoryObj } from "@storybook/react-vite";

import { SpendStatCards } from "@/modules/metrics/components/spend-stat-cards";
import { useMonthlySpend } from "@/modules/metrics/hooks/use-monthly-spend";
import { totalCostUsd } from "@/modules/metrics/lib/totals";

import { IDS } from "../../backend/scenario";
import { inScenario } from "../shared/in-scenario";

/** Totals for one agent's month, summed the way SandboxUsageSection does. */
function AgentMonth() {
  const { data } = useMonthlySpend(IDS.codingAgent);
  if (!data) return null;
  const rows = data.byModel;
  return (
    <SpendStatCards
      costUsd={totalCostUsd(rows)}
      calls={rows.reduce((n, r) => n + r.calls, 0)}
      tokensIn={rows.reduce(
        (n, r) => n + r.inputTokens + r.cacheReadTokens + r.cacheCreationTokens,
        0,
      )}
      tokensOut={rows.reduce((n, r) => n + r.outputTokens, 0)}
      durationMs={rows.reduce((n, r) => n + r.durationMs, 0)}
    />
  );
}

const meta = {
  title: "Components/Metrics/SpendStatCards",
  component: SpendStatCards,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[880px]">
        <Story />
      </div>
    ),
    inScenario("populated"),
  ],
  args: { costUsd: 0, calls: 0, tokensIn: 0, tokensOut: 0, durationMs: 0 },
} satisfies Meta<typeof SpendStatCards>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AgentThisMonth: Story = { render: () => <AgentMonth /> };

/** A month with no calls. */
export const Zero: Story = {};
