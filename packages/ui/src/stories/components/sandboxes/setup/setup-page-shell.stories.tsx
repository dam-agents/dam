import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "@/components/ui/button";
import { SetupPageShell } from "@/modules/sandboxes/components/setup/setup-page-shell";
import { NameSection } from "@/modules/sandboxes/components/setup/setup-sections";

const meta = {
  title: "Components/Sandboxes/Setup/SetupPageShell",
  component: SetupPageShell,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-[720px]">
        <Story />
      </div>
    ),
  ],
  args: {
    title: "Create an agent",
    subtitle: "Configure your agent with a name, harness, and connections.",
    footer: <Button>Create agent</Button>,
    children: <NameSection value="checkout-service" onChange={() => {}} />,
  },
} satisfies Meta<typeof SetupPageShell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
