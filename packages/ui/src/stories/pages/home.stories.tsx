import type { Meta, StoryObj } from "@storybook/react-vite";

import { AppAtRoute } from "../app-at-route";

const meta = {
  title: "Pages/Home",
  component: AppAtRoute,
  args: { path: "/" },
} satisfies Meta<typeof AppAtRoute>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {};
export const Empty: Story = { args: { scenario: "empty" } };
