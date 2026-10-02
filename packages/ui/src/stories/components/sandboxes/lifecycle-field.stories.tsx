import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import {
  DEFAULT_HIBERNATE_MIN,
  LifecycleField,
} from "@/modules/sandboxes/components/lifecycle-field";

const meta = {
  title: "Components/Sandboxes/LifecycleField",
  component: LifecycleField,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
  args: { value: DEFAULT_HIBERNATE_MIN, onChange: fn() },
} satisfies Meta<typeof LifecycleField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const HibernateWhenIdle: Story = {};

/** Always on, with the size known: names the reserved CPU and memory. */
export const AlwaysOn: Story = {
  args: { value: 0, sizeMi: { cpuMilli: 2000, memoryMi: 2048 } },
};

/** Always on without a size: the generic reserve line. */
export const AlwaysOnNoSize: Story = { args: { value: 0 } };

export const WithError: Story = {
  args: { value: Number.NaN, error: "Enter a whole number of minutes." },
};

export const Disabled: Story = { args: { disabled: true } };
