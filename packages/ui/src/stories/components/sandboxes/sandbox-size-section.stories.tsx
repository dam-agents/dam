import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { SandboxSizeSection } from "@/modules/sandboxes/components/sandbox-size-section";

/** Size presets and free slots come from the fake backend's
 *  `budgets.reserved` (1 CPU / 2Gi slots, 8 CPU ceiling). */
const meta = {
  title: "Components/Sandboxes/SandboxSizeSection",
  component: SandboxSizeSection,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
  args: { sizeCpuMilli: 1000, sizeMemoryMi: 2048, onChange: fn() },
} satisfies Meta<typeof SandboxSizeSection>;

export default meta;
type Story = StoryObj<typeof meta>;

/** New sandbox, one slot. */
export const OneSlot: Story = {};

/** Existing 2-CPU sandbox: changing size restarts it. */
export const ExistingSandbox: Story = {
  args: {
    sizeCpuMilli: 2000,
    sizeMemoryMi: 4096,
    currentSize: { cpu: "2", memory: "2Gi" },
  },
};

/** A size larger than the free budget shows the slot warning. */
export const OverBudget: Story = {
  args: { sizeCpuMilli: 4000, sizeMemoryMi: 8192 },
};

export const Disabled: Story = { args: { disabled: true } };
