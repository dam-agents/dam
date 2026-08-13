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
import type { BusRpc } from "../../../core/bus-rpc.js";
import type { BlobHandoff } from "../../../core/blob-handoff.js";

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

export type ChannelRpcRequest = {
  method:
    | "listConversations"
    | "postMessage"
    | "reply"
    | "react"
    | "describeUsers"
    | "supportsUserLookup"
    | "describeMessageReactions"
    | "supportsMessageReactions";
  args: unknown[];
};

type WireAttachment = Omit<ChannelAttachment, "data"> & { dataKey: string };

export function createChannelManager(deps: {
  slackWorker?: SlackWorker;
  telegramWorker?: TelegramWorker;
  rpc?: BusRpc<ChannelRpcRequest, unknown>;
  blobs?: BlobHandoff;
  isLeader?: () => boolean;
}): ChannelManager {
  const { slackWorker, telegramWorker, rpc, blobs } = deps;
  const isLeader = deps.isLeader ?? (() => true);
  const workers: Worker[] = [slackWorker, telegramWorker].filter(
    Boolean,
  ) as Worker[];
  const subscriptions: Subscription[] = [];
  let stopServing: (() => void) | null = null;

  async function standDown() {
    stopServing?.();
    stopServing = null;
    await Promise.all(workers.map((w) => w.stopAll()));
  }

  async function dispatch<T>(
    method: ChannelRpcRequest["method"],
    args: unknown[],
    local: () => Promise<T>,
  ): Promise<T> {
    if (isLeader() || !rpc) return local();
    return rpc.call({ method, args }) as Promise<T>;
  }

  async function dispatchResult<T>(
    method: ChannelRpcRequest["method"],
    args: unknown[],
    local: () => Promise<T>,
  ): Promise<T | { error: string }> {
    try {
      return await dispatch(method, args, local);
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

      const wire = options?.attachment as
        | (ChannelAttachment & Partial<WireAttachment>)
        | undefined;
      if (wire?.dataKey) {
        const data = await blobs?.take(wire.dataKey);
        if (!data)
          return {
            error:
              "attachment bytes were not available on the posting replica; retry the send",
          };
        const { dataKey: _key, ...meta } = wire;
        options = { ...options, attachment: { ...meta, data } };
      }
      return worker.postMessage(instanceName, text, options);
    },
    reply: (
      instanceName: string,
      channelType: ChannelType,
      replyArgs: ChannelReply,
    ) => {
      const worker = workers.find((w) => w.type === channelType);
      if (!worker?.reply)
        return Promise.resolve({
          error: `reply not supported on ${channelType}`,
        });
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
        if (slackWorker && isLeader()) {
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
        if (slackWorker && isLeader()) slackWorker.stop(event.agentId);
      }),
  );

  subscriptions.push(
    events$()
      .pipe(ofType<AgentDeleted>(EventType.AgentDeleted))
      .subscribe((event) => {
        if (slackWorker && isLeader()) slackWorker.stop(event.agentId);
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
      if (rpc) {
        stopServing?.();
        stopServing = rpc.serve(async (req) => {
          const handler = localHandlers[req.method] as
            | ((...a: unknown[]) => Promise<unknown>)
            | undefined;
          if (!handler)
            throw new Error(`unknown channel rpc method ${req.method}`);
          return handler(...req.args);
        });
      }

      if (telegramWorker) await telegramWorker.start();
      if (slackWorker) await slackWorker.connect();

      for (const [agentId, channels] of channelsByInstance) {
        for (const channel of channels) {
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
      return dispatch("listConversations", [instanceName, channelType], () =>
        localHandlers.listConversations(instanceName, channelType),
      ).catch(() => []);
    },

    async postMessage(instanceName, channelType, text, options) {
      let wireOptions = options;
      if (!isLeader() && rpc && options?.attachment) {
        if (!blobs)
          return {
            error: "cannot post an attachment from this replica (no handoff)",
          };
        const { data, ...meta } = options.attachment;
        wireOptions = {
          ...options,
          attachment: {
            ...meta,
            dataKey: await blobs.put(data),
          } as unknown as ChannelAttachment,
        };
      }
      return dispatchResult(
        "postMessage",
        [instanceName, channelType, text, wireOptions],
        () =>
          localHandlers.postMessage(instanceName, channelType, text, options),
      );
    },

    reply(instanceName, channelType, replyArgs) {
      return dispatchResult(
        "reply",
        [instanceName, channelType, replyArgs],
        () => localHandlers.reply(instanceName, channelType, replyArgs),
      );
    },

    react(instanceName, channelType, reaction) {
      return dispatchResult(
        "react",
        [instanceName, channelType, reaction],
        () => localHandlers.react(instanceName, channelType, reaction),
      );
    },

    describeUsers(instanceName, channelType, userIds) {
      return dispatchResult(
        "describeUsers",
        [instanceName, channelType, userIds],
        () => localHandlers.describeUsers(instanceName, channelType, userIds),
      );
    },

    supportsUserLookup() {
      return dispatch(
        "supportsUserLookup",
        [],
        localHandlers.supportsUserLookup,
      ).catch(() => true);
    },

    describeMessageReactions(instanceName, channelType, query) {
      return dispatchResult(
        "describeMessageReactions",
        [instanceName, channelType, query],
        () =>
          localHandlers.describeMessageReactions(
            instanceName,
            channelType,
            query,
          ),
      );
    },

    supportsMessageReactions() {
      return dispatch(
        "supportsMessageReactions",
        [],
        localHandlers.supportsMessageReactions,
      ).catch(() => true);
    },
  };
}
