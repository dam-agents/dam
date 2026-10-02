import type { Meta, StoryObj } from "@storybook/react-vite";

import { labelVariants } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const meta = {
  title: "Components/UI/Label",
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "`label.tsx` exports only the `labelVariants` class, not a component. SectionLabel and FormField apply it; the private-registry disclosure applies it to a button.",
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const OnASpan: Story = {
  render: () => <span className={labelVariants()}>Theme</span>,
};

export const OnAButton: Story = {
  render: () => (
    <button
      type="button"
      className={cn(labelVariants(), "hover:text-foreground")}
    >
      Private registry
    </button>
  ),
};
