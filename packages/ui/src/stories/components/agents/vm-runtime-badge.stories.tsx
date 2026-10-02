import type { Meta, StoryObj } from "@storybook/react-vite";

import { VmRuntimeBadge } from "../../../modules/agents/components/vm-runtime-badge.js";
import { codingAgent, seedAgents, seedVmRuntime } from "./story-helpers";

/** Which badge shows depends on the agent and on whether the install runs the
 *  new sandbox runtime (the "vm-sandboxes" flag plus install virtualization). */
const meta = {
  title: "Components/Agents/VmRuntimeBadge",
  component: VmRuntimeBadge,
  parameters: { layout: "centered" },
  loaders: [seedAgents()],
  args: { agent: codingAgent({ vm: true }) },
} satisfies Meta<typeof VmRuntimeBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

const vmOn = () => (seedVmRuntime(true), {});
const vmOff = () => (seedVmRuntime(false), {});

/** A VM agent on an install where the runtime is not the default. */
export const NewRuntime: Story = { loaders: [vmOff] };

export const OldRuntime: Story = {
  loaders: [vmOn],
  args: { agent: codingAgent({ vm: false, runtimeMigratable: true }) },
};

export const Migrating: Story = {
  loaders: [vmOn],
  args: {
    agent: codingAgent({
      state: "migrating",
      runtimeMigration: { phase: "copying", abortable: true, retryable: false },
    }),
  },
};

export const MigrationFailed: Story = {
  loaders: [vmOn],
  args: {
    agent: codingAgent({
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
