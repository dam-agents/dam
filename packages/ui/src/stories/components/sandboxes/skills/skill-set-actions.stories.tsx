import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { SkillSetActions } from "@/modules/sandboxes/components/skills/skill-set-actions";

const meta = {
  title: "Components/Sandboxes/Skills/SkillSetActions",
  component: SkillSetActions,
  parameters: { layout: "padded" },
  args: {
    canSave: true,
    previewReady: true,
    onAddSets: fn(),
    onSaveSet: fn(),
  },
  decorators: [
    (Story) => (
      <div className="flex items-center gap-2">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SkillSetActions>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
/** No source skill is on, so there is nothing to save. */
export const NothingToSave: Story = { args: { canSave: false } };
/** Sources are still being read. */
export const PreviewNotReady: Story = { args: { previewReady: false } };
