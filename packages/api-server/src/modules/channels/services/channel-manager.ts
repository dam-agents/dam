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

/** A reply threaded under the turn the agent is answering. */
export interface ChannelReply {
  text: string;
  /** Thread to post into. Omitted, it resolves to the sole in-flight turn's
   *  thread; with several turns in flight at once the reply is refused rather
   *  than guessed, so the agent must pass this (the prompt injects it). */
  threadTs?: string;
  /** Conversation override; defaults to the bound channel. */
  conversationId?: string;
  /** Surface the reply in the channel too, not only inside the thread — one
   *  post in both places. For threads that have scrolled out of the channel,
   *  where a thread-only reply would go unseen. Off by default. */
  alsoSendToChannel?: boolean;
}

/** An emoji reaction on a specific message. */
export interface ChannelReaction {
  /** Emoji short name, no surrounding colons (e.g. `eyes`, `white_check_mark`). */
  emoji: string;
  /** Message to react to. Omitted, it resolves to the sole in-flight turn's
   *  message; with several turns in flight at once the react is refused rather
   *  than guessed, so the agent must pass this (the prompt injects it). */
  messageTs?: string;
  /** Conversation override; defaults to the bound channel. */
  conversationId?: string;
}

/** One person behind a messenger user id. Everything but `id` is optional —
 *  the messenger reports only what the person filled in and what the app's
 *  scopes cover. `error` marks an id that alone failed to resolve, so one bad
 *  id in a batch never costs the caller the others. */
export interface ChannelUser {
  id: string;
  username?: string;
  realName?: string;
  displayName?: string;
  title?: string;
  pronouns?: string;
  email?: string;
  timezone?: string;
  timezoneLabel?: string;
  statusText?: string;
  statusEmoji?: string;
  isBot?: boolean;
  isDeleted?: boolean;
  error?: string;
}

/** The dispatch surface both adapters share; per-agent lifecycle is
 *  Slack-only (Telegram is a single platform bot with data-only bindings).
 *  `reply`/`react` are turn-scoped affordances only Slack implements today. */
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
  reply?(
    instanceName: string,
    reply: ChannelReply,
  ): Promise<{ ok: true } | { error: string }>;
  react?(
    instanceName: string,
    reaction: ChannelReaction,
  ): Promise<{ ok: true } | { error: string }>;
  describeUsers?(
    instanceName: string,
    userIds: string[],
  ): Promise<{ users: ChannelUser[] } | { error: string }>;
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
  reply(
    instanceName: string,
    channelType: ChannelType,
    reply: ChannelReply,
  ): Promise<{ ok: true } | { error: string }>;
  react(
    instanceName: string,
    channelType: ChannelType,
    reaction: ChannelReaction,
  ): Promise<{ ok: true } | { error: string }>;
  /** Resolve messenger user ids to the people behind them. */
  describeUsers(
    instanceName: string,
    channelType: ChannelType,
    userIds: string[],
  ): Promise<{ users: ChannelUser[] } | { error: string }>;
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
            ...(event.mode ? { mode: event.mode } : {}),
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
      // Both platform bots connect unconditionally at startup — inbound
      // commands (the bind command), mentions and DMs must reach the bot in
      // chats that have no binding yet. Slack opens its socket-mode connection
      // here rather than lazily on the first bind/post, so it never misses
      // those events.
      if (telegramWorker) await telegramWorker.start();
      if (slackWorker) await slackWorker.connect();

      // The socket is already up; walking the bindings only restores the
      // per-Agent registration the SlackConnected event installs at runtime.
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

    async reply(instanceName, channelType, replyArgs) {
      const worker = workers.find((w) => w.type === channelType);
      if (!worker?.reply)
        return { error: `reply not supported on ${channelType}` };
      return worker.reply(instanceName, replyArgs);
    },

    async react(instanceName, channelType, reaction) {
      const worker = workers.find((w) => w.type === channelType);
      if (!worker?.react)
        return { error: `reactions not supported on ${channelType}` };
      return worker.react(instanceName, reaction);
    },

    async describeUsers(instanceName, channelType, userIds) {
      const worker = workers.find((w) => w.type === channelType);
      if (!worker?.describeUsers)
        return { error: `user lookup not supported on ${channelType}` };
      return worker.describeUsers(instanceName, userIds);
    },
  };
}
