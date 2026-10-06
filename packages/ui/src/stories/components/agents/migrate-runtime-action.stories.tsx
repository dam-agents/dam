import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";

import { MigrateRuntimeAction } from "../../../modules/agents/components/migrate-runtime-action.js";
import { codingAgent, seedAgents, seedVmRuntime } from "./story-helpers";

/** The agent row's runtime-migration control. It only appears on an install
 *  running the new sandbox runtime, so every story turns that on. */
const meta = {
  title: "Components/Agents/MigrateRuntimeAction",
  component: MigrateRuntimeAction,
  parameters: { layout: "centered" },
  loaders: [seedAgents(), () => (seedVmRuntime(true), {})],
  args: {
    agent: codingAgent({ runtimeMigratable: true }),
    pending: false,
    controlsBusy: false,
    onMigrate: fn(),
    onAbort: fn(),
    onRetry: fn(),
  },
} satisfies Meta<typeof MigrateRuntimeAction>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Offer: Story = {};

export const OfferHoverCard: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.hover(
      within(canvasElement).getByRole("button", { name: /migrate/i }),
    );
  },
};

export const Requesting: Story = { args: { pending: true } };

export const Migrating: Story = {
  args: {
    agent: codingAgent({
      state: "migrating",
      runtimeMigration: { phase: "copying", abortable: true, retryable: false },
    }),
  },
};

/** Past the point of no return: no Abort. */
export const Booting: Story = {
  args: {
    agent: codingAgent({
      state: "migrating",
      runtimeMigration: {
        phase: "verified",
        abortable: false,
        retryable: false,
      },
    }),
  },
};

export const Failed: Story = {
  args: {
    agent: codingAgent({
      state: "error",
      runtimeMigration: {
        phase: "failed",
        message: "copy job timed out after 10m",
        attempts: 1,
        abortable: true,
        retryable: true,
      },
    }),
  },
};

/** The api-server would refuse this agent; tapping lists why (from the
 *  fixture backend's migration plan). */
export const Refused: Story = {
  args: { agent: codingAgent({ runtimeMigratable: false }) },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", {
        name: "Why this agent can't migrate",
      }),
    );
  },
};
