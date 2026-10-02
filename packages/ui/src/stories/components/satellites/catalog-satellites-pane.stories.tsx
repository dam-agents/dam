import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { CatalogSatellitesPane } from "@/modules/satellites/components/catalog-satellites-pane";

import { IDS } from "../../backend/scenario";
import { SATELLITES } from "./sample-satellites";

const meta = {
  title: "Components/Satellites/CatalogSatellitesPane",
  component: CatalogSatellitesPane,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="flex max-w-2xl flex-col gap-4">
        <Story />
      </div>
    ),
  ],
  args: { satellites: SATELLITES },
} satisfies Meta<typeof CatalogSatellitesPane>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ForAgent: Story = {
  args: {
    grant: (s) => ({
      granted: s.grantedAgentIds.includes(IDS.codingAgent),
      onToggle: fn(),
    }),
  },
};
