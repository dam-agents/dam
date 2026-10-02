import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { CreateApiKeyDialog } from "@/modules/api-keys/components/create-api-key-dialog";

const meta = {
  title: "Components/ApiKeys/CreateApiKeyDialog",
  component: CreateApiKeyDialog,
  args: { onClose: fn() },
} satisfies Meta<typeof CreateApiKeyDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {};
