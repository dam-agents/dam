import { ChannelType, type ChannelConfig } from "api-server-api";
import type { Subscription } from "rxjs";
import {
  events$,
  ofType,
  EventType,
  type SlackConnected,
  type SlackDisconnected,
  type TelegramConnected,
  type TelegramDisconnected,
  type AgentDeleted,
} from "../../../events.js";
import type { SlackWorker } from "../infrastructure/slack.js";
import type { TelegramWorker } from "../infrastructure/telegram.js";
import type { StoredChannelConfig } from "../stored-channel.js";
import type { ChannelSecretStore } from "../infrastructure/channel-secret-store.js";

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

interface Worker {
  type: ChannelType;
  start(instanceName: string, channel: StoredChannelConfig): Promise<void>;
  stop(instanceName: string): Promise<void>;
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
  channelSecretStore: ChannelSecretStore;
}): ChannelManager {
  const { slackWorker, telegramWorker, channelSecretStore } = deps;
  const workers: Worker[] = [slackWorker, telegramWorker].filter(
    Boolean,
  ) as Worker[];
  const subscriptions: Subscription[] = [];

  async function startTelegram(agentId: string): Promise<void> {
    if (!telegramWorker) return;
    const botToken = await channelSecretStore.readTelegramToken(agentId);
    if (!botToken) {
      process.stderr.write(
        `[channel-manager] Telegram secret missing for ${agentId}; skipping start\n`,
      );
      return;
    }
    await telegramWorker.start(agentId, {
      type: ChannelType.Telegram,
      botToken,
    });
  }

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
      .pipe(ofType<TelegramConnected>(EventType.TelegramConnected))
      .subscribe((event) => {
        startTelegram(event.agentId).catch((err) => {
          process.stderr.write(
            `[channel-manager] Telegram start failed for ${event.agentId}: ${err}\n`,
          );
        });
      }),
  );

  subscriptions.push(
    events$()
      .pipe(ofType<TelegramDisconnected>(EventType.TelegramDisconnected))
      .subscribe((event) => {
        if (telegramWorker) telegramWorker.stop(event.agentId);
      }),
  );

  subscriptions.push(
    events$()
      .pipe(ofType<AgentDeleted>(EventType.AgentDeleted))
      .subscribe((event) => {
        for (const w of workers) w.stop(event.agentId);
      }),
  );

  return {
    availableChannels() {
      return Object.fromEntries(workers.map((w) => [w.type, true]));
    },

    async bootstrap(channelsByInstance: Map<string, ChannelConfig[]>) {
      for (const [agentId, channels] of channelsByInstance) {
        for (const channel of channels) {
          if (channel.type === ChannelType.Telegram) {
            await startTelegram(agentId);
          } else if (channel.type === ChannelType.Slack && slackWorker) {
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
