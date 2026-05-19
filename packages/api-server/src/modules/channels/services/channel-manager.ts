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
  type InstanceDeleted,
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

  async function startTelegram(instanceId: string): Promise<void> {
    if (!telegramWorker) return;
    const botToken = await channelSecretStore.readTelegramToken(instanceId);
    if (!botToken) {
      process.stderr.write(
        `[channel-manager] Telegram secret missing for ${instanceId}; skipping start\n`,
      );
      return;
    }
    await telegramWorker.start(instanceId, {
      type: ChannelType.Telegram,
      botToken,
    });
  }

  subscriptions.push(
    events$()
      .pipe(ofType<SlackConnected>(EventType.SlackConnected))
      .subscribe((event) => {
        if (slackWorker) {
          slackWorker.start(event.instanceId, {
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
        if (slackWorker) slackWorker.stop(event.instanceId);
      }),
  );

  subscriptions.push(
    events$()
      .pipe(ofType<TelegramConnected>(EventType.TelegramConnected))
      .subscribe((event) => {
        startTelegram(event.instanceId).catch((err) => {
          process.stderr.write(
            `[channel-manager] Telegram start failed for ${event.instanceId}: ${err}\n`,
          );
        });
      }),
  );

  subscriptions.push(
    events$()
      .pipe(ofType<TelegramDisconnected>(EventType.TelegramDisconnected))
      .subscribe((event) => {
        if (telegramWorker) telegramWorker.stop(event.instanceId);
      }),
  );

  subscriptions.push(
    events$()
      .pipe(ofType<InstanceDeleted>(EventType.InstanceDeleted))
      .subscribe((event) => {
        for (const w of workers) w.stop(event.instanceId);
      }),
  );

  return {
    availableChannels() {
      return Object.fromEntries(workers.map((w) => [w.type, true]));
    },

    async bootstrap(channelsByInstance: Map<string, ChannelConfig[]>) {
      for (const [instanceId, channels] of channelsByInstance) {
        for (const channel of channels) {
          if (channel.type === ChannelType.Telegram) {
            await startTelegram(instanceId);
          } else if (channel.type === ChannelType.Slack && slackWorker) {
            await slackWorker.start(instanceId, channel);
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
