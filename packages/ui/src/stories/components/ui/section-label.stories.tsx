import type { Meta, StoryObj } from "@storybook/react-vite";

import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";

const meta = {
  title: "Components/UI/SectionLabel",
  component: SectionLabel,
  parameters: { layout: "padded" },
  args: { children: "Profile", spaced: false },
  argTypes: {
    spaced: { control: "boolean" },
    children: { control: "text" },
  },
} satisfies Meta<typeof SectionLabel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const SpacedAboveContent: Story = {
  args: { spaced: true, children: "Theme" },
  render: (args) => (
    <div className="max-w-xl">
      <SectionLabel {...args} />
      <Card className="p-4 text-sm">Follow your operating system setting</Card>
    </div>
  ),
};
