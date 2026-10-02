import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { NameSection } from "@/modules/sandboxes/components/setup/setup-sections";

/** From setup-sections.tsx. The avatar preview shows only when the
 *  agent-avatars flag is on (off in the fixture install). */
const meta = {
  title: "Components/Sandboxes/Setup/NameSection",
  component: NameSection,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
  args: { value: "", onChange: fn() },
} satisfies Meta<typeof NameSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
export const Filled: Story = { args: { value: "checkout-service" } };
