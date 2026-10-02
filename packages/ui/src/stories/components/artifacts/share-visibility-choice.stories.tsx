import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { ShareVisibilityChoice } from "@/modules/artifacts/components/share-visibility-choice";

const meta = {
  title: "Components/Artifacts/ShareVisibilityChoice",
  component: ShareVisibilityChoice,
  parameters: { layout: "padded" },
  args: { value: "private", onChange: fn(), disabled: false },
  argTypes: {
    value: {
      control: "inline-radio",
      options: ["private", "restricted", "public"],
    },
  },
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ShareVisibilityChoice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Private: Story = {};
export const Restricted: Story = { args: { value: "restricted" } };
export const Public: Story = { args: { value: "public" } };
/** While a save is in flight. */
export const Disabled: Story = { args: { value: "public", disabled: true } };
