import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { ProviderSection } from "@/modules/sandboxes/components/setup/setup-sections";
import { setupProviderPolicy } from "@/modules/sandboxes/lib/setup-policy";

/** From setup-sections.tsx. Providers come from the fake backend; the first
 *  allowed one is auto-selected. */
const meta = {
  title: "Components/Sandboxes/Setup/ProviderSection",
  component: ProviderSection,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
  args: {
    selected: null,
    onSelect: fn(),
    policy: setupProviderPolicy("coding-agent"),
  },
} satisfies Meta<typeof ProviderSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CodingAgentFlow: Story = {};
