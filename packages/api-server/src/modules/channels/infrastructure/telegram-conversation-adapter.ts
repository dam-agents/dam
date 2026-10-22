import {
  TelegramAdapter,
  type TelegramMessage,
  type TelegramUpdate,
} from "@chat-adapter/telegram";
import type { WebhookOptions } from "chat";

type InboundMessage = TelegramMessage & { is_topic_message?: boolean };

function withoutReplyThread(message: InboundMessage): InboundMessage {
  return message.message_thread_id === undefined || message.is_topic_message
    ? message
    : { ...message, message_thread_id: undefined };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Chat SDK Telegram adapter, with one change to
 * what counts as a conversation. Telegram sets `message_thread_id` on a forum
 * topic message, and in a supergroup also on any reply. The stock adapter
 * makes both a thread of their own, so a reply to the bot became a
 * conversation that no binding, session or subscription knew. Before an update
 * is routed, this drops the id from a message that is not a forum topic
 * message, so a reply belongs to its chat and a topic stays its own
 * conversation. Posting back then also leaves the id out, which Telegram
 * accepts only for a forum topic.
 */
export class TelegramConversationAdapter extends TelegramAdapter {
  protected override processUpdate(
    update: TelegramUpdate,
    options?: WebhookOptions,
  ) {
    return super.processUpdate(
      {
        ...update,
        ...(update.message && { message: withoutReplyThread(update.message) }),
        ...(update.edited_message && {
          edited_message: withoutReplyThread(update.edited_message),
        }),
      },
      options,
    );
  }
}
