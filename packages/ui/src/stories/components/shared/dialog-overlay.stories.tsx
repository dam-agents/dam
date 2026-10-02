import { TrashCan } from "@carbon/icons-react";
import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";

import { DialogOverlay } from "@/components/dialog-overlay";
import { useStore } from "@/store";

type Open = (s: ReturnType<typeof useStore.getState>) => unknown;

/** Opens the dialog through the store's own showConfirm/showAlert. */
const opened =
  (open: Open): Decorator =>
  (Story) => {
    useEffect(() => {
      void open(useStore.getState());
      return () => useStore.getState().closeDialog(false);
    }, []);
    return <Story />;
  };

const meta = {
  title: "Components/Shared/DialogOverlay",
  component: DialogOverlay,
} satisfies Meta<typeof DialogOverlay>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Confirm: Story = {
  decorators: [
    opened((s) =>
      s.showConfirm(
        "The agent will stop and its compute is released until you resume it.",
        "Hibernate agent?",
        { confirmLabel: "Hibernate" },
      ),
    ),
  ],
};

export const Destructive: Story = {
  decorators: [
    opened((s) =>
      s.showConfirm(
        "This permanently deletes the agent, its sessions and its workspace.",
        "Delete agent?",
        { kind: "destructive", icon: TrashCan, confirmLabel: "Delete" },
      ),
    ),
  ],
};

export const Alert: Story = {
  decorators: [
    opened((s) => s.showAlert("The agent could not be started. Try again.")),
  ],
};

export const Info: Story = {
  decorators: [
    opened((s) =>
      s.showAlert(
        "Your changes are saved and apply on the next session.",
        "Saved",
        { kind: "info", confirmLabel: "Got it" },
      ),
    ),
  ],
};
