import type { Meta, StoryObj } from "@storybook/react-vite";

import { Card } from "@/components/ui/card";
import {
  SkillRowsSkeleton,
  SkillSourcesSkeleton,
} from "@/modules/sandboxes/components/skills/skills-skeleton";

const meta = {
  title: "Components/Sandboxes/Skills/SkillsSkeleton",
  component: SkillSourcesSkeleton,
  parameters: { layout: "padded" },
  args: { cards: 2 },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SkillSourcesSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

/** `SkillSourcesSkeleton`: placeholder source cards. */
export const SourceCards: Story = {};
/** `SkillRowsSkeleton`: placeholder rows inside a loading source card. */
export const Rows: Story = {
  render: () => (
    <Card>
      <SkillRowsSkeleton rows={3} />
    </Card>
  ),
};
