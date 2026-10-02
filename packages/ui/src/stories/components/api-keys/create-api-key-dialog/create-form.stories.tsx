import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { Modal } from "@/components/modal";
import { CreateApiKeyForm } from "@/modules/api-keys/components/create-api-key-dialog/create-form";

/** Rendered inside the real `Modal`, as `CreateApiKeyDialog` does. */
const meta = {
  title: "Components/ApiKeys/CreateApiKeyForm",
  component: CreateApiKeyForm,
  decorators: [
    (Story) => (
      <Modal>
        <Story />
      </Modal>
    ),
  ],
  args: { onCreated: fn(), onCancel: fn() },
} satisfies Meta<typeof CreateApiKeyForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
