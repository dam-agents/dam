import type { Meta, StoryObj } from "@storybook/react-vite";

import { GrantRivalryCallout } from "@/modules/connections/components/grant-rivalry-callout";

import { connectionById } from "./catalog-data";

const github = connectionById("conn-github");

const meta = {
  title: "Components/Connections/GrantRivalryCallout",
  component: GrantRivalryCallout,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
  args: {
    // A second GitHub account signing in to the same hosts. The fixtures hold
    // one GitHub connection, so the rival is that connection under another name.
    granted: [
      github,
      { ...github, id: "conn-github-work", name: "github-work" },
    ],
  },
} satisfies Meta<typeof GrantRivalryCallout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Rivalry: Story = {};

/** The fixture agent's grants do not collide, so nothing renders. */
export const NoRivalry: Story = {
  args: {
    granted: [connectionById("conn-github"), connectionById("conn-anthropic")],
  },
};
