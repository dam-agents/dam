import type { Meta, StoryObj } from "@storybook/react-vite";

import { LazyRobotHead } from "../../../modules/agents/components/avatar/lazy-robot-head.js";
import { AGENTS } from "../../backend/fixtures/agents";

const meta = {
  title: "Components/Agents/LazyRobotHead",
  component: LazyRobotHead,
  parameters: { layout: "centered" },
  args: { name: AGENTS[1]!.name, size: 64 },
} satisfies Meta<typeof LazyRobotHead>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Sleeping: Story = { args: { sleeping: true } };
