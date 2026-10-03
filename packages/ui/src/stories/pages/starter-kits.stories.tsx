import type { Meta, StoryObj } from "@storybook/react-vite";

import { AppAtRoute } from "../app-at-route";
import { IDS } from "../backend/scenario";
import { withExpandedSidebar } from "./_shell";

const kit = `/starter-kits/${IDS.kitCatalog}/${IDS.kit}`;

const meta = {
  title: "Pages/Starter kits",
  component: AppAtRoute,
  args: { path: "/starter-kits" },
  decorators: [withExpandedSidebar],
} satisfies Meta<typeof AppAtRoute>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Browse: Story = {};
export const KitDetail: Story = { args: { path: kit } };
export const KitSetup: Story = { args: { path: `${kit}/new` } };
