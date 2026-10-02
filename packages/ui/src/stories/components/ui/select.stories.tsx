import type { Meta, StoryObj } from "@storybook/react-vite";

import { Select } from "@/components/ui/select";
import { formatCpuMemory } from "@/modules/budgets/lib/slots";

const VARIANTS = ["standard", "ghost", "invalid"] as const;
const SIZES = ["default", "sm", "xs"] as const;

const COMPUTE = [1, 2, 4, 8].map((cores) =>
  formatCpuMemory({ cpuMilli: cores * 1000, memoryMi: cores * 1024 }),
);

const RETENTION = [
  "Never delete",
  "Delete in 1 hour",
  "Delete in 1 day",
  "Delete in 7 days",
  "Delete in 30 days",
];

const meta = {
  title: "Components/UI/Select",
  component: Select,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
  args: {
    variant: "standard",
    size: "default",
    disabled: false,
    "aria-label": "Compute resources",
    defaultValue: COMPUTE[1],
    children: COMPUTE.map((label) => (
      <option key={label} value={label}>
        {label}
      </option>
    )),
  },
  argTypes: {
    variant: { control: "inline-radio", options: VARIANTS },
    size: { control: "inline-radio", options: SIZES },
    disabled: { control: "boolean" },
    children: { control: false },
  },
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const AllVariants: Story = {
  decorators: [
    (Story) => (
      <div className="max-w-3xl">
        <Story />
      </div>
    ),
  ],
  render: (args) => (
    <div className="grid grid-cols-3 gap-3">
      {SIZES.map((size) =>
        VARIANTS.map((variant) => (
          <Select
            key={`${size}-${variant}`}
            {...args}
            size={size}
            variant={variant}
            aria-label={`${variant} ${size}`}
          />
        )),
      )}
    </div>
  ),
};

export const Small: Story = {
  args: {
    size: "sm",
    "aria-label": "Delete after",
    defaultValue: RETENTION[0],
    children: RETENTION.map((label) => (
      <option key={label} value={label}>
        {label}
      </option>
    )),
  },
};

export const Ghost: Story = { args: { variant: "ghost" } };

export const Invalid: Story = { args: { variant: "invalid" } };

export const Disabled: Story = { args: { disabled: true } };
