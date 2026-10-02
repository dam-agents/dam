import type { Meta, StoryObj } from "@storybook/react-vite";

import { getBrand } from "@/brand";

import { BindTerminalPage } from "../../../modules/agents/components/bind/bind-terminal-page.js";
import {
  bindErrorCopy,
  callbackErrorCopy,
} from "../../../modules/slack/lib/bind-flow.js";
import { bindErrorCopy as telegramBindErrorCopy } from "../../../modules/telegram/lib/bind-flow.js";

/** The hint names the brand's slash command, so it is built at render time:
 *  the brand loads after the story modules do. */
function SlackHint({ copy }: { copy: (short: string) => { hint: string } }) {
  return <p>{copy(getBrand().short).hint}</p>;
}

const expired = (short: string) => callbackErrorCopy("expired", short);
const unresolved = (short: string) =>
  bindErrorCopy("UNPROCESSABLE_CONTENT", short);
const telegramInvalid = telegramBindErrorCopy("BAD_REQUEST");

/** A bind flow's dead end. Title and hint are the real error copy. */
const meta = {
  title: "Components/Agents/BindTerminalPage",
  component: BindTerminalPage,
  args: {
    messenger: "slack",
    title: expired("").title,
    children: <SlackHint copy={expired} />,
  },
} satisfies Meta<typeof BindTerminalPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SlackLinkExpired: Story = {};

export const SlackWorkspaceUnresolved: Story = {
  args: {
    title: unresolved("").title,
    children: <SlackHint copy={unresolved} />,
  },
};

export const TelegramInvalidLink: Story = {
  args: {
    messenger: "telegram",
    title: telegramInvalid.title,
    children: <p>{telegramInvalid.hint}</p>,
  },
};
