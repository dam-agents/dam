import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { PickerFooter } from "../../../modules/agents/components/bind/picker-footer.js";
import { SLACK_PICKER_COPY } from "./bind-copy";

const meta = {
  title: "Components/Agents/PickerFooter",
  component: PickerFooter,
  decorators: [
    (Story) => (
      <div className="flex h-screen flex-col justify-end">
        <Story />
      </div>
    ),
  ],
  args: {
    consent: SLACK_PICKER_COPY.consent,
    action: SLACK_PICKER_COPY.action,
    enabled: true,
    pending: false,
    onConfirm: fn(),
  },
} satisfies Meta<typeof PickerFooter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};
export const NothingPicked: Story = { args: { enabled: false } };
export const Adding: Story = { args: { pending: true } };
