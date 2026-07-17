import { ChannelType, type ChannelConfig } from "api-server-api";
import type { Subscription } from "rxjs";
import {
  events$,
  ofType,
  EventType,
  type SlackConnected,
  type SlackDisconnected,
  type AgentDeleted,
} from "../../../events.js";
import type { SlackWorker } from "../infrastructure/slack.js";
import type { TelegramWorker } from "../infrastructure/telegram.js";

export interface ChannelAttachment {
  filename: string;
  data: Buffer;
  mimeType?: string;
  title?: string;
}

export interface PostMessageOptions {
  conversationId?: string;
  attachment?: ChannelAttachment;
}

/** The dispatch surface both adapters share; per-agent lifecycle is
 *  Slack-only (Telegram is a single platform bot with data-only bindings). */
interface Worker {
  type: ChannelType;
  stopAll(): Promise<void>;
  listConversations(
    instanceName: string,
  ): Promise<{ id: string; title: string }[]>;
  postMessage(
    instanceName: string,
    text: string,
    options?: PostMessageOptions,
  ): Promise<{ ok: true } | { error: string }>;
}

export interface ChannelManager {
  availableChannels(): Partial<Record<ChannelType, boolean>>;
  /** Platform Telegram bot handle (no @), or null when Telegram is off. */
  telegramBotUsername(): string | null;
  bootstrap(channelsByInstance: Map<string, ChannelConfig[]>): Promise<void>;
  stopAll(): Promise<void>;
  listConversations(
    instanceName: string,
    channelType: ChannelType,
  ): Promise<{ id: string; title: string }[]>;
  postMessage(
    instanceName: string,
    channelType: ChannelType,
    text: string,
    options?: PostMessageOptions,
  ): Promise<{ ok: true } | { error: string }>;
}

export function createChannelManager(deps: {
  slackWorker?: SlackWorker;
  telegramWorker?: TelegramWorker;
}): ChannelManager {
  const { slackWorker, telegramWorker } = deps;
  const workers: Worker[] = [slackWorker, telegramWorker].filter(
    Boolean,
  ) as Worker[];
  const subscriptions: Subscription[] = [];

  subscriptions.push(
    events$()
      .pipe(ofType<SlackConnected>(EventType.SlackConnected))
      .subscribe((event) => {
        if (slackWorker) {
          slackWorker.start(event.agentId, {
            type: ChannelType.Slack,
            slackChannelId: event.slackChannelId,
          });
        }
      }),
  );

  subscriptions.push(
    events$()
      .pipe(ofType<SlackDisconnected>(EventType.SlackDisconnected))
      .subscribe((event) => {
        if (slackWorker) slackWorker.stop(event.agentId);
      }),
  );

  subscriptions.push(
    events$()
      .pipe(ofType<AgentDeleted>(EventType.AgentDeleted))
      .subscribe((event) => {
        // Telegram bindings are rows, not runtime state — the channel-cleanup
        // saga deletes them; only Slack tracks per-agent worker state.
        if (slackWorker) slackWorker.stop(event.agentId);
      }),
  );

  return {
    availableChannels() {
      return Object.fromEntries(workers.map((w) => [w.type, true]));
    },

    telegramBotUsername(): string | null {
      return telegramWorker?.botUsername() ?? null;
    },

    async bootstrap(channelsByInstance: Map<string, ChannelConfig[]>) {
      // The platform bot polls unconditionally — /login must work in chats
      // that have no binding yet.
      if (telegramWorker) await telegramWorker.start();

      for (const [agentId, channels] of channelsByInstance) {
        for (const channel of channels) {
          if (channel.type === ChannelType.Slack && slackWorker) {
            await slackWorker.start(agentId, channel);
          }
        }
      }
    },

    async stopAll() {
      for (const sub of subscriptions) sub.unsubscribe();
      await Promise.all(workers.map((w) => w.stopAll()));
    },

    async listConversations(instanceName: string, channelType: ChannelType) {
      const worker = workers.find((w) => w.type === channelType);
      if (!worker) return [];
      return worker.listConversations(instanceName);
    },

    async postMessage(
      instanceName: string,
      channelType: ChannelType,
      text: string,
      options?: PostMessageOptions,
    ) {
      const worker = workers.find((w) => w.type === channelType);
      if (!worker)
        return { error: `channel type ${channelType} not available` };
      return worker.postMessage(instanceName, text, options);
    },
  };
}
