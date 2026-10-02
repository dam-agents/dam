import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { FormField } from "@/components/form-field";
import {
  DialogActions,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const meta = {
  title: "Components/Shared/Modal",
  component: Modal,
  args: { onClose: fn(), children: null },
} satisfies Meta<typeof Modal>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Header, body and the standard Cancel / submit footer. */
export const Form: Story = {
  render: (args) => (
    <Modal {...args}>
      <DialogHeader
        title="Rename agent"
        subtitle="The name shows in the sidebar and in Slack."
        onClose={args.onClose}
      />
      <DialogBody className="flex flex-col gap-4">
        <FormField label="Name" hint="Lowercase letters, numbers and dashes.">
          <Input defaultValue="code-guardian" />
        </FormField>
      </DialogBody>
      <DialogActions
        divided
        onCancel={fn()}
        onSubmit={fn()}
        label="Save"
        pendingLabel="Saving…"
      />
    </Modal>
  ),
};

export const Pending: Story = {
  render: (args) => (
    <Modal {...args}>
      <DialogHeader title="Rename agent" onClose={args.onClose} closeDisabled />
      <DialogBody>
        <Input defaultValue="code-guardian" disabled />
      </DialogBody>
      <DialogActions
        onCancel={fn()}
        onSubmit={fn()}
        label="Save"
        pendingLabel="Saving…"
        pending
        cancelDisabled
      />
    </Modal>
  ),
};

export const Destructive: Story = {
  render: (args) => (
    <Modal {...args} widthClass="w-[440px]">
      <DialogHeader title="Delete agent?" onClose={args.onClose} />
      <DialogBody>
        <p className="text-sm text-muted-foreground">
          This permanently deletes code-guardian, its sessions and its
          workspace.
        </p>
      </DialogBody>
      <DialogActions
        onCancel={fn()}
        onSubmit={fn()}
        label="Delete"
        pendingLabel="Deleting…"
        destructive
      />
    </Modal>
  ),
};

/** Title accessory, header actions, a leading footer slot and a flush body. */
export const HeaderExtras: Story = {
  render: (args) => (
    <Modal {...args} widthClass="w-[720px]" heightClass="h-[480px]">
      <DialogHeader
        title="checkout-service/src/payments/refunds.ts"
        truncateTitle
        titleAccessory={<Badge variant="muted">v3</Badge>}
        actions={
          <Button variant="outline" size="sm">
            Download
          </Button>
        }
        onClose={args.onClose}
      />
      <DialogBody flush>
        <div className="px-6 text-sm text-muted-foreground">
          Flush body content runs edge to edge.
        </div>
      </DialogBody>
      <DialogFooter divided>
        <Button variant="outline" className="mr-auto">
          Previous version
        </Button>
        <Button>Done</Button>
      </DialogFooter>
    </Modal>
  ),
};
