import type { Meta, StoryObj } from "@storybook/react-vite";

import { BindPage } from "../../../modules/agents/components/bind/bind-page.js";
import { SLACK_PICKER_COPY, TELEGRAM_PICKER_COPY } from "./bind-copy";

/** The shell every bind page shares: messenger icon + title, then content. */
const meta = {
  title: "Components/Agents/BindPage",
  component: BindPage,
  args: {
    messenger: "slack",
    title: SLACK_PICKER_COPY.title,
    subtitle: SLACK_PICKER_COPY.subtitle,
  },
} satisfies Meta<typeof BindPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Slack: Story = {};
export const Telegram: Story = {
  args: {
    messenger: "telegram",
    title: TELEGRAM_PICKER_COPY.title,
    subtitle: TELEGRAM_PICKER_COPY.subtitle,
  },
};
/** The narrower text column the success and error pages use. */
export const Narrow: Story = { args: { narrow: true } };
