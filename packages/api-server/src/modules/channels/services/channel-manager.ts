import { z } from "zod";
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

export interface ChannelReply {
  text: string;
  threadTs?: string;
  conversationId?: string;
  alsoSendToChannel?: boolean;
  attachment?: ChannelAttachment;
}

export interface ChannelReaction {
  emoji: string;
  messageTs?: string;
  conversationId?: string;
}

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

export interface ChannelMessageReaction {
  name: string;
  count: number;
  users: string[];
}

export interface ReactionsQuery {
  conversationId?: string;
  messageTs?: string;
}

export interface MessageReactionsResult {
  reactions: ChannelMessageReaction[];
  conversationId: string;
  messageTs: string;
}

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
  declineTurn?(instanceName: string): Promise<{ ok: true } | { error: string }>;
  handOffTurn?(
    instanceName: string,
    targetName: string,
    note?: string,
  ): Promise<{ ok: true; agent: string } | { error: string }>;
  describeUsers?(
    instanceName: string,
    userIds: string[],
  ): Promise<{ users: ChannelUser[] } | { error: string }>;
  supportsUserLookup?(): Promise<boolean>;
  describeMessageReactions?(
    instanceName: string,
    query: ReactionsQuery,
  ): Promise<MessageReactionsResult | { error: string }>;
  supportsMessageReactions?(): Promise<boolean>;
}

export interface ChannelManager {
  availableChannels(): Partial<Record<ChannelType, boolean>>;
  telegramBotUsername(): string | null;
  bootstrap(channelsByInstance: Map<string, ChannelConfig[]>): Promise<void>;
  standDown(): Promise<void>;
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
  declineTurn(
    instanceName: string,
    channelType: ChannelType,
  ): Promise<{ ok: true } | { error: string }>;
  handOffTurn(
    instanceName: string,
    channelType: ChannelType,
    targetName: string,
    note?: string,
  ): Promise<{ ok: true; agent: string } | { error: string }>;
  describeUsers(
    instanceName: string,
    channelType: ChannelType,
    userIds: string[],
  ): Promise<{ users: ChannelUser[] } | { error: string }>;
  supportsUserLookup(): Promise<boolean>;
  describeMessageReactions(
    instanceName: string,
    channelType: ChannelType,
    query: ReactionsQuery,
  ): Promise<MessageReactionsResult | { error: string }>;
  supportsMessageReactions(): Promise<boolean>;
}

const TRANSPORT_RETRY_MS = 60_000;

export function createChannelManager(deps: {
  slackWorker?: SlackWorker;
  telegramWorker?: TelegramWorker;
}): ChannelManager {
  const { slackWorker, telegramWorker } = deps;
  const workers: Worker[] = [slackWorker, telegramWorker].filter(
    Boolean,
  ) as Worker[];

  const subscriptions: Subscription[] = [];
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;

  /**
   * UNIT_BOUNDARY_DESCRIPTION: A transport that fails to start does not cost
   * the lease. Nothing about a provider outage is replica-specific, so handing
   * the lease on would only ping-pong it between replicas that fail the same
   * way — while the transports that did come up go down with each handover.
   * The holder keeps the lease, serves whatever started, and retries the rest
   * on a timer until it stands down. Both the retry and the start itself carry
   * the generation they began in: a stand-down moves it, so a start still in
   * flight neither re-arms the timer nor keeps serving on an ex-leader.
   */
  async function startTransports(generationAtStart: number): Promise<void> {
    if (generationAtStart !== generation) return;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    const attempts: [string, () => Promise<unknown>][] = [];
    if (telegramWorker)
      attempts.push(["telegram", () => telegramWorker.start()]);
    if (slackWorker) attempts.push(["slack", () => slackWorker.connect()]);
    const results = await Promise.allSettled(attempts.map(([, go]) => go()));
    if (generationAtStart !== generation) return;
    const failed = results.flatMap((r, i) =>
      r.status === "rejected"
        ? [{ name: attempts[i]![0], reason: r.reason }]
        : [],
    );
    for (const f of failed) {
      process.stderr.write(
        `[channels] ${f.name} worker start failed, retrying in ${TRANSPORT_RETRY_MS / 1000}s: ${f.reason instanceof Error ? f.reason.message : f.reason}\n`,
      );
    }
    if (failed.length === 0) return;
    retryTimer = setTimeout(
      () => void startTransports(generationAtStart),
      TRANSPORT_RETRY_MS,
    );
    retryTimer.unref?.();
  }

  async function standDown() {
    generation += 1;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    const stopped = await Promise.allSettled(workers.map((w) => w.stopAll()));
    const failed = stopped.flatMap((r) =>
      r.status === "rejected" ? [r.reason] : [],
    );
    if (failed.length)
      throw new Error(`channel workers failed to stop: ${failed.join("; ")}`);
  }

  /** A worker throwing is reported to the caller, never to the turn. */
  async function guarded<T>(
    local: () => Promise<T>,
  ): Promise<T | { error: string }> {
    try {
      return await local();
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  const localHandlers = {
    listConversations: (instanceName: string, channelType: ChannelType) => {
      const worker = workers.find((w) => w.type === channelType);
      if (!worker) return Promise.resolve([]);
      return worker.listConversations(instanceName);
    },
    postMessage: async (
      instanceName: string,
      channelType: ChannelType,
      text: string,
      options?: PostMessageOptions,
    ) => {
      const worker = workers.find((w) => w.type === channelType);
      if (!worker)
        return { error: `channel type ${channelType} not available` };

      return worker.postMessage(instanceName, text, options);
    },
    reply: async (
      instanceName: string,
      channelType: ChannelType,
      replyArgs: ChannelReply,
    ) => {
      const worker = workers.find((w) => w.type === channelType);
      if (!worker?.reply)
        return { error: `reply not supported on ${channelType}` };
      return worker.reply(instanceName, replyArgs);
    },
    react: (
      instanceName: string,
      channelType: ChannelType,
      reaction: ChannelReaction,
    ) => {
      const worker = workers.find((w) => w.type === channelType);
      if (!worker?.react)
        return Promise.resolve({
          error: `reactions not supported on ${channelType}`,
        });
      return worker.react(instanceName, reaction);
    },
    declineTurn: (instanceName: string, channelType: ChannelType) => {
      const worker = workers.find((w) => w.type === channelType);
      if (!worker?.declineTurn)
        return Promise.resolve({
          error: `declining a turn is not supported on ${channelType}`,
        });
      return worker.declineTurn(instanceName);
    },
    handOffTurn: (
      instanceName: string,
      channelType: ChannelType,
      targetName: string,
      note?: string,
    ) => {
      const worker = workers.find((w) => w.type === channelType);
      if (!worker?.handOffTurn)
        return Promise.resolve({
          error: `handing a turn to another agent is not supported on ${channelType}`,
        });
      return worker.handOffTurn(instanceName, targetName, note);
    },
    describeUsers: (
      instanceName: string,
      channelType: ChannelType,
      userIds: string[],
    ) => {
      const worker = workers.find((w) => w.type === channelType);
      if (!worker?.describeUsers)
        return Promise.resolve({
          error: `user lookup not supported on ${channelType}`,
        });
      return worker.describeUsers(instanceName, userIds);
    },
    supportsUserLookup: async () => {
      const capable = workers.filter((w) => w.describeUsers);
      if (capable.length === 0) return true;
      const results = await Promise.all(
        capable.map((w) => w.supportsUserLookup?.() ?? Promise.resolve(true)),
      );
      return results.some(Boolean);
    },
    describeMessageReactions: (
      instanceName: string,
      channelType: ChannelType,
      query: ReactionsQuery,
    ) => {
      const worker = workers.find((w) => w.type === channelType);
      if (!worker?.describeMessageReactions)
        return Promise.resolve({
          error: `message reactions not supported on ${channelType}`,
        });
      return worker.describeMessageReactions(instanceName, query);
    },
    supportsMessageReactions: async () => {
      const capable = workers.filter((w) => w.describeMessageReactions);
      if (capable.length === 0) return true;
      const results = await Promise.all(
        capable.map(
          (w) => w.supportsMessageReactions?.() ?? Promise.resolve(true),
        ),
      );
      return results.some(Boolean);
    },
  } as const;

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
      const generationAtStart = generation;
      await startTransports(generationAtStart);

      for (const [agentId, channels] of channelsByInstance) {
        for (const channel of channels) {
          if (generationAtStart !== generation) return;
          if (channel.type === ChannelType.Slack && slackWorker) {
            await slackWorker.start(agentId, channel);
          }
        }
      }
    },

    standDown,

    async stopAll() {
      for (const sub of subscriptions) sub.unsubscribe();
      await standDown();
    },

    listConversations(instanceName, channelType) {
      return localHandlers
        .listConversations(instanceName, channelType)
        .catch(() => []);
    },

    postMessage(instanceName, channelType, text, options) {
      return guarded(() =>
        localHandlers.postMessage(instanceName, channelType, text, options),
      );
    },

    reply(instanceName, channelType, replyArgs) {
      return guarded(() =>
        localHandlers.reply(instanceName, channelType, replyArgs),
      );
    },

    react(instanceName, channelType, reaction) {
      return guarded(() =>
        localHandlers.react(instanceName, channelType, reaction),
      );
    },

    declineTurn(instanceName, channelType) {
      return guarded(() =>
        localHandlers.declineTurn(instanceName, channelType),
      );
    },

    handOffTurn(instanceName, channelType, targetName, note) {
      return guarded(() =>
        localHandlers.handOffTurn(instanceName, channelType, targetName, note),
      );
    },

    describeUsers(instanceName, channelType, userIds) {
      return guarded(() =>
        localHandlers.describeUsers(instanceName, channelType, userIds),
      );
    },

    supportsUserLookup() {
      return localHandlers.supportsUserLookup().catch(() => true);
    },

    describeMessageReactions(instanceName, channelType, query) {
      return guarded(() =>
        localHandlers.describeMessageReactions(
          instanceName,
          channelType,
          query,
        ),
      );
    },

    supportsMessageReactions() {
      return localHandlers.supportsMessageReactions().catch(() => true);
    },
  };
}
