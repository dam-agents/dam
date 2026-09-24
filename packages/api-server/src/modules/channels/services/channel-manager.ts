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
import type {
  DeleteAgentPostResult,
  SlackWorker,
} from "../infrastructure/slack.js";
import type {
  SlackConversationName,
  SlackConversationRef,
} from "../infrastructure/slack-gateway.js";
import type { SlackConversationStanding } from "./slack-workspace-probe.js";
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
  unfurlLinks?: boolean;
  unfurlMedia?: boolean;
}

export interface ChannelReply {
  text: string;
  threadTs?: string;
  conversationId?: string;
  alsoSendToChannel?: boolean;
  attachment?: ChannelAttachment;
  unfurlLinks?: boolean;
  unfurlMedia?: boolean;
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

export interface ThreadQuery {
  threadTs: string;
  cursor?: string;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: One window of a thread as the reading Agent gets
 * it. `hasMore` says the window is not the whole thread and `cursor` is how to
 * reach the rest, so the two together say which end is missing: a cursor means
 * the remainder sits before this window, and its absence under `hasMore` means
 * the thread is longer than a read can walk and nothing reaches the newest
 * replies. That second state carries no handle on purpose. The window returned
 * there is a slice from the middle whose position the platform cannot vouch
 * for, and a handle inviting a walk from it would send the Agent back through
 * the wrong part of a thread whose end it never saw.
 */
export interface ThreadResult {
  messages: string[];
  conversationId: string;
  threadTs: string;
  hasMore: boolean;
  cursor?: string;
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
  describeMessageReactions?(
    instanceName: string,
    query: ReactionsQuery,
  ): Promise<MessageReactionsResult | { error: string }>;
  resolveConversationNames?(
    refs: SlackConversationRef[],
  ): Promise<SlackConversationName[]>;
  readThread?(
    instanceName: string,
    query: ThreadQuery,
  ): Promise<ThreadResult | { error: string }>;
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
  describeMessageReactions(
    instanceName: string,
    channelType: ChannelType,
    query: ReactionsQuery,
  ): Promise<MessageReactionsResult | { error: string }>;
  resolveSlackConversationNames(
    refs: SlackConversationRef[],
  ): Promise<SlackConversationName[]>;
  slackConversationStanding(
    slackChannelId: string,
    teamId: string,
  ): Promise<SlackConversationStanding>;
  readThread(
    instanceName: string,
    channelType: ChannelType,
    query: ThreadQuery,
  ): Promise<ThreadResult | { error: string }>;
  deleteSlackPost(
    instanceName: string,
    postRef: string,
    reason: string | null,
  ): Promise<DeleteAgentPostResult>;
}

export const channelRpcRequestSchema = z.object({
  method: z.enum([
    "listConversations",
    "postMessage",
    "reply",
    "react",
    "declineTurn",
    "handOffTurn",
    "describeUsers",
    "describeMessageReactions",
    "resolveConversationNames",
    "slackConversationStanding",
    "readThread",
    "deleteSlackPost",
  ]),
  args: z.array(z.unknown()),
});
export type ChannelRpcRequest = z.infer<typeof channelRpcRequestSchema>;

const forInstance = z.tuple([z.string(), z.enum(ChannelType)]);
const slackConversationRefSchema = z.object({
  channelId: z.string(),
  teamId: z.string(),
});
const rpcArgSchemas: Record<ChannelRpcRequest["method"], z.ZodTypeAny> = {
  listConversations: forInstance,
  postMessage: forInstance.rest(z.unknown()),
  reply: forInstance.rest(z.unknown()),
  react: forInstance.rest(z.unknown()),
  declineTurn: forInstance,
  handOffTurn: forInstance.rest(z.unknown()),
  describeUsers: forInstance.rest(z.unknown()),
  describeMessageReactions: forInstance.rest(z.unknown()),
  resolveConversationNames: z.tuple([z.array(slackConversationRefSchema)]),
  slackConversationStanding: z.tuple([z.string(), z.string()]),
  readThread: forInstance.rest(z.unknown()),
  deleteSlackPost: z.tuple([z.string(), z.string(), z.string().nullable()]),
};

const TRANSPORT_RETRY_MS = 60_000;

const okOrErrorSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ error: z.string() }),
]);
const channelUserSchema = z.object({
  id: z.string(),
  username: z.string().optional(),
  realName: z.string().optional(),
  displayName: z.string().optional(),
  title: z.string().optional(),
  pronouns: z.string().optional(),
  email: z.string().optional(),
  timezone: z.string().optional(),
  timezoneLabel: z.string().optional(),
  statusText: z.string().optional(),
  statusEmoji: z.string().optional(),
  isBot: z.boolean().optional(),
  isDeleted: z.boolean().optional(),
  error: z.string().optional(),
});
const rpcResponseSchemas: Record<ChannelRpcRequest["method"], z.ZodTypeAny> = {
  listConversations: z.array(z.object({ id: z.string(), title: z.string() })),
  postMessage: okOrErrorSchema,
  reply: okOrErrorSchema,
  react: okOrErrorSchema,
  declineTurn: okOrErrorSchema,
  handOffTurn: z.union([
    z.object({ ok: z.literal(true), agent: z.string() }),
    z.object({ error: z.string() }),
  ]),
  describeUsers: z.union([
    z.object({ users: z.array(channelUserSchema) }),
    z.object({ error: z.string() }),
  ]),
  describeMessageReactions: z.union([
    z.object({
      reactions: z.array(
        z.object({
          name: z.string(),
          count: z.number(),
          users: z.array(z.string()),
        }),
      ),
      conversationId: z.string(),
      messageTs: z.string(),
    }),
    z.object({ error: z.string() }),
  ]),
  resolveConversationNames: z.array(
    slackConversationRefSchema.extend({ name: z.string().nullable() }),
  ),
  slackConversationStanding: z.enum(["member", "known", "unknown"]),
  readThread: z.union([
    z.object({
      messages: z.array(z.string()),
      conversationId: z.string(),
      threadTs: z.string(),
      hasMore: z.boolean(),
      cursor: z.string().optional(),
    }),
    z.object({ error: z.string() }),
  ]),
  deleteSlackPost: z.union([
    z.object({ ok: z.literal(true), agentWillBeTold: z.boolean() }),
    z.object({ error: z.string() }),
  ]),
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

  async function stashAttachment(
    attachment: ChannelAttachment,
  ): Promise<ChannelAttachment | { error: string }> {
    if (!blobs)
      return {
        error: "cannot post an attachment from this replica (no handoff)",
      };
    const { data, ...meta } = attachment;
    return {
      ...meta,
      dataKey: await blobs.put(data),
    } as unknown as ChannelAttachment;
  }

  async function restoreAttachment(
    attachment: ChannelAttachment | undefined,
  ): Promise<ChannelAttachment | undefined | { error: string }> {
    const wire = attachment as
      | (ChannelAttachment & Partial<WireAttachment>)
      | undefined;
    if (!wire?.dataKey) return attachment;
    const data = await blobs?.take(wire.dataKey);
    if (!data)
      return {
        error:
          "attachment bytes were not available on the posting replica; retry the send",
      };
    const { dataKey: _key, ...meta } = wire;
    return { ...meta, data };
  }
  const subscriptions: Subscription[] = [];
  let stopServing: (() => void) | null = null;
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
    stopServing?.();
    stopServing = null;
    const stopped = await Promise.allSettled(workers.map((w) => w.stopAll()));
    const failed = stopped.flatMap((r) =>
      r.status === "rejected" ? [r.reason] : [],
    );
    if (failed.length)
      throw new Error(`channel workers failed to stop: ${failed.join("; ")}`);
  }

  async function dispatch<T>(
    method: ChannelRpcRequest["method"],
    args: unknown[],
    local: () => Promise<T>,
  ): Promise<T> {
    if (isLeader() || !rpc) return local();
    return rpcResponseSchemas[method].parse(
      await rpc.call({ method, args }),
    ) as T;
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

      const attachment = await restoreAttachment(options?.attachment);
      if (attachment && "error" in attachment) return attachment;
      if (attachment) options = { ...options, attachment };
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
      const attachment = await restoreAttachment(replyArgs.attachment);
      if (attachment && "error" in attachment) return attachment;
      if (attachment) replyArgs = { ...replyArgs, attachment };
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
    resolveConversationNames: (refs: SlackConversationRef[]) =>
      slackWorker?.resolveConversationNames?.(refs) ?? Promise.resolve([]),
    slackConversationStanding: (
      slackChannelId: string,
      teamId: string,
    ): Promise<SlackConversationStanding> =>
      deps.slackWorker
        ? deps.slackWorker.conversationStanding(slackChannelId, teamId)
        : Promise.reject(new Error("slack worker not available")),
    deleteSlackPost: (
      instanceName: string,
      postRef: string,
      reason: string | null,
    ): Promise<DeleteAgentPostResult> =>
      slackWorker
        ? slackWorker.deleteAgentPost(instanceName, postRef, reason)
        : Promise.resolve({ error: "slack worker not available" }),
    readThread: (
      instanceName: string,
      channelType: ChannelType,
      query: ThreadQuery,
    ) => {
      const worker = workers.find((w) => w.type === channelType);
      if (!worker?.readThread)
        return Promise.resolve({
          error: `thread reads are not supported on ${channelType}`,
        });
      return worker.readThread(instanceName, query);
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
      const generationAtStart = generation;
      if (rpc) {
        stopServing?.();
        stopServing = rpc.serve(async (req) => {
          const handler = localHandlers[req.method] as
            | ((...a: unknown[]) => Promise<unknown>)
            | undefined;
          if (!handler)
            throw new Error(`unknown channel rpc method ${req.method}`);
          return handler(
            ...(rpcArgSchemas[req.method].parse(req.args) as unknown[]),
          );
        });
      }

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
      return dispatch("listConversations", [instanceName, channelType], () =>
        localHandlers.listConversations(instanceName, channelType),
      ).catch(() => []);
    },

    async postMessage(instanceName, channelType, text, options) {
      let wireOptions = options;
      if (!isLeader() && rpc && options?.attachment) {
        const attachment = await stashAttachment(options.attachment);
        if ("error" in attachment) return attachment;
        wireOptions = { ...options, attachment };
      }
      return dispatchResult(
        "postMessage",
        [instanceName, channelType, text, wireOptions],
        () =>
          localHandlers.postMessage(instanceName, channelType, text, options),
      );
    },

    async reply(instanceName, channelType, replyArgs) {
      let wireArgs = replyArgs;
      if (!isLeader() && rpc && replyArgs.attachment) {
        const attachment = await stashAttachment(replyArgs.attachment);
        if ("error" in attachment) return attachment;
        wireArgs = { ...replyArgs, attachment };
      }
      return dispatchResult(
        "reply",
        [instanceName, channelType, wireArgs],
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

    declineTurn(instanceName, channelType) {
      return dispatchResult("declineTurn", [instanceName, channelType], () =>
        localHandlers.declineTurn(instanceName, channelType),
      );
    },

    handOffTurn(instanceName, channelType, targetName, note) {
      return dispatchResult(
        "handOffTurn",
        [instanceName, channelType, targetName, note],
        () =>
          localHandlers.handOffTurn(
            instanceName,
            channelType,
            targetName,
            note,
          ),
      );
    },

    describeUsers(instanceName, channelType, userIds) {
      return dispatchResult(
        "describeUsers",
        [instanceName, channelType, userIds],
        () => localHandlers.describeUsers(instanceName, channelType, userIds),
      );
    },

    resolveSlackConversationNames(refs) {
      return dispatch("resolveConversationNames", [refs], () =>
        localHandlers.resolveConversationNames(refs),
      ).catch(() => []);
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

    slackConversationStanding(slackChannelId, teamId) {
      return dispatch(
        "slackConversationStanding",
        [slackChannelId, teamId],
        () => localHandlers.slackConversationStanding(slackChannelId, teamId),
      );
    },

    readThread(instanceName, channelType, query) {
      return dispatchResult(
        "readThread",
        [instanceName, channelType, query],
        () => localHandlers.readThread(instanceName, channelType, query),
      );
    },

    deleteSlackPost(instanceName, postRef, reason) {
      return dispatchResult(
        "deleteSlackPost",
        [instanceName, postRef, reason],
        () => localHandlers.deleteSlackPost(instanceName, postRef, reason),
      );
    },
  };
}
