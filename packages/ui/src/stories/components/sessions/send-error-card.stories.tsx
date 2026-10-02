import type { Meta, StoryObj } from "@storybook/react-vite";

import { SendErrorCard } from "../../../modules/sessions/components/send-error-card.js";

/** The error under an agent reply that failed. The hint is matched from the
 *  raw error by the real `describeSendError`. */
const meta = {
  title: "Components/Sessions/SendErrorCard",
  component: SendErrorCard,
  parameters: { layout: "padded" },
  args: { rawError: "Connection closed (code 1006)" },
} satisfies Meta<typeof SendErrorCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SendFailed: Story = {};

/** The reply had started when it broke off. */
export const Interrupted: Story = { args: { interrupted: true } };

export const OutOfCredits: Story = {
  args: {
    rawError:
      "402 Payment Required: Your credit balance is too low to access the Anthropic API.",
  },
};

export const BadCredential: Story = {
  args: { rawError: "401 authentication_error: invalid x-api-key" },
};

export const RateLimited: Story = {
  args: { rawError: "429 rate_limit_error: Number of requests exceeded" },
};
