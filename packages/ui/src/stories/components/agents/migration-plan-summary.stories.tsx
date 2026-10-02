import type { Meta, StoryObj } from "@storybook/react-vite";

import type { RuntimeMigrationPlanView } from "@/types";

import { MigrationPlanSummary } from "../../../modules/agents/components/migration-plan-summary.js";
import { AGENTS } from "../../backend/fixtures/agents";

/** The body of the "Migrate to the new runtime" confirm dialog. The base plan
 *  is the one the fixture backend's `agents.planRuntimeMigration` returns,
 *  made allowed. */
const PLAN: RuntimeMigrationPlanView = {
  unmovable: [],
  storageSize: "10Gi",
  storageResized: false,
  bootsSleepingAgent: false,
  retentionMs: 7 * 24 * 60 * 60_000,
  allowed: true,
  refusal: null,
};

const meta = {
  title: "Components/Agents/MigrationPlanSummary",
  component: MigrationPlanSummary,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[480px] text-sm text-muted-foreground">
        <Story />
      </div>
    ),
  ],
  args: { name: AGENTS[0]!.name, plan: PLAN },
} satisfies Meta<typeof MigrationPlanSummary>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const DiskResized: Story = {
  args: { plan: { ...PLAN, storageSize: "20Gi", storageResized: true } },
};

export const SleepingAgent: Story = {
  args: {
    name: AGENTS[3]!.name,
    plan: { ...PLAN, bootsSleepingAgent: true },
  },
};

export const NoRetention: Story = {
  args: { plan: { ...PLAN, retentionMs: null } },
};
