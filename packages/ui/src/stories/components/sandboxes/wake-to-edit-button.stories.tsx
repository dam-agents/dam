import type { Meta, StoryObj } from "@storybook/react-vite";

import { WakeToEditButton } from "@/modules/sandboxes/components/sandbox-wake-to-edit";

import { IDS } from "../../backend/scenario";

/** From sandbox-wake-to-edit.tsx. */
const meta = {
  title: "Components/Sandboxes/WakeToEditButton",
  component: WakeToEditButton,
  parameters: { layout: "padded" },
  args: { agentId: IDS.hibernatedAgent, comingUp: false },
} satisfies Meta<typeof WakeToEditButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Asleep: Story = {};
export const Starting: Story = { args: { comingUp: true } };
