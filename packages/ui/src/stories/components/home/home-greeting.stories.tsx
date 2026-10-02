import type { Meta, StoryObj } from "@storybook/react-vite";

import { EntryPointButtons } from "@/modules/agents/components/entry-point-buttons";
import { HomeGreeting } from "@/modules/home/components/home-greeting";

const meta = {
  title: "Components/Home/HomeGreeting",
  component: HomeGreeting,
  parameters: { layout: "padded" },
  args: { title: "Agents" },
} satisfies Meta<typeof HomeGreeting>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The greeting follows the viewer's local time of day. */
export const Default: Story = {};

/** First visit, before any agents exist. */
export const Welcome: Story = { args: { title: "Welcome" } };

/** Home with agents: the create buttons sit on the right. */
export const WithActions: Story = {
  args: {
    actions: <EntryPointButtons surface="home" primary="agent" />,
  },
};
