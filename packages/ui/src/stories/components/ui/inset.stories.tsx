import type { Meta, StoryObj } from "@storybook/react-vite";

import { Card } from "@/components/ui/card";
import { Inset, LABEL_INSET } from "@/components/ui/inset";
import { SectionLabel } from "@/components/ui/section-label";

const meta = {
  title: "Components/UI/Inset",
  component: Inset,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-2xl border-l border-dashed border-border pl-4">
        <Story />
      </div>
    ),
  ],
  args: {
    className: "flex flex-col gap-3",
    children: (
      <>
        <Card className="p-4 text-sm">GitHub</Card>
        <Card className="p-4 text-sm">Linear</Card>
      </>
    ),
  },
} satisfies Meta<typeof Inset>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CardList: Story = {};

export const WithInsetLabel: Story = {
  render: (args) => (
    <div className="flex flex-col gap-3">
      <SectionLabel className={LABEL_INSET}>Connections</SectionLabel>
      <Inset {...args} />
    </div>
  ),
};
