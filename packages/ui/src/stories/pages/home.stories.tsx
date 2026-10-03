import type { Meta, StoryObj } from "@storybook/react-vite";

import { AppAtRoute } from "../app-at-route";
import { withExpandedSidebar } from "./_shell";

const meta = {
  title: "Pages/Home",
  component: AppAtRoute,
  args: { path: "/" },
  decorators: [withExpandedSidebar],
} satisfies Meta<typeof AppAtRoute>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {};
export const Empty: Story = { args: { scenario: "empty" } };
