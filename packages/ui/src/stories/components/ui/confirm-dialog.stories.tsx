import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const meta = {
  title: "Components/UI/ConfirmDialog",
  component: ConfirmDialog,
  parameters: { layout: "fullscreen" },
  args: {
    open: true,
    onOpenChange: fn(),
    onConfirm: fn(),
    onCancel: fn(),
    kind: "default",
    title: "Restart agent?",
    description:
      "Saving will restart the agent to apply its new size — in-flight work is interrupted.",
    confirmLabel: "Save & restart",
    showCancel: true,
    cancelLabel: "Cancel",
  },
  argTypes: {
    kind: {
      control: "inline-radio",
      options: ["default", "destructive", "info"],
    },
    icon: { control: false },
    title: { control: "text" },
    description: { control: "text" },
    confirmLabel: { control: "text" },
  },
} satisfies Meta<typeof ConfirmDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Destructive: Story = {
  args: {
    kind: "destructive",
    title: "Delete “Weekly dependency report”?",
    description:
      "All versions are deleted and its share link stops working. This cannot be undone.",
    confirmLabel: "Delete",
  },
};

export const DestructiveDefaultLabel: Story = {
  args: {
    kind: "destructive",
    title: "Delete Agent",
    description: (
      <>
        Delete agent{" "}
        <strong className="text-foreground">"release-notes-bot"</strong>? This
        will also delete <strong>all persistent data</strong> and cannot be
        undone.
      </>
    ),
    confirmLabel: undefined,
  },
};

export const Info: Story = {
  args: {
    kind: "info",
    title: "This schedule is managed by the agent",
    description: (
      <div className="flex flex-col gap-3">
        <p>
          release-notes-bot created this schedule, so changes must be made
          through the agent.
        </p>
        <p>
          Ask the agent in chat to change when it runs or what it does. You can
          pause or delete it here anytime.
        </p>
      </div>
    ),
    confirmLabel: "Open chat",
    cancelLabel: "Close",
  },
};

export const AlertWithoutCancel: Story = {
  args: {
    kind: "info",
    showCancel: false,
    title: "This schedule uses the older cron format",
    description:
      "To change when it runs, delete this schedule and create a new one. You can pause it here anytime.",
    confirmLabel: "Close",
  },
};
