import type { Meta, StoryObj } from "@storybook/react";

import { Checkbox, CheckboxItem } from "./checkbox";

const meta: Meta = {
  title: "Components/Checkbox",
  parameters: { layout: "centered" },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => <Checkbox />,
};

export const Checked: Story = {
  render: () => <Checkbox defaultChecked />,
};

export const WithLabel: Story = {
  name: "CheckboxItem with label",
  render: () => <CheckboxItem label="Enable notifications" />,
};

export const WithDescription: Story = {
  name: "CheckboxItem with description",
  render: () => (
    <CheckboxItem
      label="Auto-hibernate idle agents"
      description="Automatically hibernate agents that have been idle for more than 30 minutes to save compute."
    />
  ),
};

export const CheckboxGroup: Story = {
  name: "Checkbox group",
  render: () => (
    <div className="flex w-[400px] flex-col gap-4">
      <CheckboxItem
        label="Email notifications"
        description="Receive email alerts when sessions complete or fail."
        defaultChecked
      />
      <CheckboxItem
        label="Slack notifications"
        description="Post session results to your connected Slack channel."
      />
      <CheckboxItem
        label="Webhook notifications"
        description="Send a POST request to your webhook URL on session events."
      />
    </div>
  ),
};
