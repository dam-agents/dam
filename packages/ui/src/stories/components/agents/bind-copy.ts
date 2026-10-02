import type { BindPickerCopy } from "../../../modules/agents/components/bind/agent-bind-picker.js";

/** Verbatim copies of the private `pickerCopy` in the Slack and Telegram bind
 *  views (`modules/slack/views/slack-bind-view.tsx`,
 *  `modules/telegram/views/telegram-bind-view.tsx`); keep them in sync. */
export const SLACK_PICKER_COPY: BindPickerCopy = {
  messenger: "slack",
  title: "Pick an agent for #help-platform",
  subtitle:
    "Choose which agent to add to this channel. You can add more agents to the same channel later.",
  emptySubtitle:
    "You don't own any agents yet. Create one to add it to this channel.",
  consent:
    "Everyone in the channel will be able to use the agent. Turns run under the agent's own connected accounts and API tokens, and your acceptance of the Terms of Use covers every turn.",
  action: "Add to channel",
};

export const TELEGRAM_PICKER_COPY: BindPickerCopy = {
  messenger: "telegram",
  title: "Pick an agent",
  subtitle:
    "Choose which agent to add to this chat. A chat talks to one agent — send /unbind there to swap it for another.",
  emptySubtitle:
    "You don't own any agents yet. Create one to add it to this chat.",
  consent:
    "Everyone in the chat will be able to use the agent. Turns run under the agent's own connected accounts and API tokens, and your acceptance of the Terms of Use covers every turn.",
  action: "Add to chat",
};
