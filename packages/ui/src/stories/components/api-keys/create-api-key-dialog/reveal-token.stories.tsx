import type { Meta, StoryObj } from "@storybook/react-vite";
import { API_KEY_PREFIX } from "api-server-api";
import { fn } from "storybook/test";

import { Modal } from "@/components/modal";
import { RevealToken } from "@/modules/api-keys/components/create-api-key-dialog/reveal-token";

/** No query serves a plaintext token (only `apiKeys.create` returns one), so
 *  this is a token in the real shape: prefix + 32 random bytes, base64url. */
const PLAINTEXT = `${API_KEY_PREFIX}q7Vt3xK9mB2nR8wZ1cL5pF0hJ4sD6gY-aE_uT3oN9kM`;

const meta = {
  title: "Components/ApiKeys/RevealToken",
  component: RevealToken,
  decorators: [
    (Story) => (
      <Modal>
        <Story />
      </Modal>
    ),
  ],
  args: { plaintext: PLAINTEXT, onClose: fn() },
} satisfies Meta<typeof RevealToken>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Revealed: Story = {};
