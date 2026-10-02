import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { LifecycleSetupSection } from "@/modules/sandboxes/components/setup/setup-sections";

/** From setup-sections.tsx: LifecycleField under a "Lifecycle" label. */
const meta = {
  title: "Components/Sandboxes/Setup/LifecycleSetupSection",
  component: LifecycleSetupSection,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
  args: { value: null, onChange: fn() },
} satisfies Meta<typeof LifecycleSetupSection>;

export default meta;
type Story = StoryObj<typeof meta>;

/** `null` falls back to the 60-minute default. */
export const Default: Story = {};

export const AlwaysOn: Story = {
  args: { value: 0, sizeMi: { cpuMilli: 2000, memoryMi: 2048 } },
};
