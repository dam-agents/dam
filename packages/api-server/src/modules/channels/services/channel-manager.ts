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
import type {
  SlackConversationRef,
  SlackLabelledConversation,
} from "../infrastructure/slack-gateway.js";
import type { SlackConversationStanding } from "./slack-workspace-probe.js";
import type {
  SlackChannelChoices,
  SlackChannelMembership,
} from "../domain/slack-channel-choices.js";
import type { TelegramWorker } from "../infrastructure/telegram.js";
import type { BusRpc } from "../../../core/bus-rpc.js";
import type { BlobHandoff } from "../../../core/blob-handoff.js";
import {
  attachmentResultSchema,
  channelUserSchema,
  messageReactionsResultSchema,
  sendResultSchema,
  threadResultSchema,
  type AddressedWorker,
  type AttachmentQuery,
  type AttachmentResult,
  type ChannelAttachment,
  type ChannelReaction,
  type ChannelReply,
  type ChannelSendResult,
  type ChannelUser,
  type ChannelWorker,
  type MessageReactionsResult,
  type PersonNotice,
  type PostMessageOptions,
  type ReactionsQuery,
  type ThreadQuery,
  type ThreadResult,
  type WireAttachment,
} from "./worker-contract.js";

export type {
  AttachmentQuery,
  AttachmentResult,
  ChannelAttachment,
  ChannelMessageReaction,
  ChannelReaction,
  ChannelReply,
  ChannelSendResult,
  ChannelUser,
  MessageReactionsResult,
  PostMessageOptions,
  ReactionsQuery,
  ThreadQuery,
  ThreadResult,
} from "./worker-contract.js";

export interface ChannelManager {
  availableChannels(): Partial<Record<ChannelType, boolean>>;
  telegramBotUsername(): string | null;
  bootstrap(channelsByInstance: Map<string, ChannelConfig[]>): Promise<void>;
  standDown(): Promise<void>;
  stopAll(): Promise<void>;
  listConversations(
    instanceName: string,
    channelType: ChannelType,
  ): Promise<{ id: string; title: string; profileId?: string | null }[]>;
  postMessage(
    instanceName: string,
    channelType: ChannelType,
    text: string,
    options?: PostMessageOptions,
  ): Promise<ChannelSendResult>;
  reply(
    instanceName: string,
    channelType: ChannelType,
    reply: ChannelReply,
  ): Promise<ChannelSendResult>;
  react(
    instanceName: string,
    channelType: ChannelType,
    reaction: ChannelReaction,
  ): Promise<{ ok: true } | { error: string }>;
  declineTurn(
    instanceName: string,
    channelType: ChannelType,
    threadTs?: string,
  ): Promise<{ ok: true } | { error: string }>;
  handOffTurn(
    instanceName: string,
    channelType: ChannelType,
    threadTs: string,
    targetName: string,
    note?: string,
  ): Promise<{ ok: true; agent: string } | { error: string }>;
  describeUsers(
    instanceName: string,
    channelType: ChannelType,
    userIds: string[],
    conversationId?: string,
  ): Promise<{ users: ChannelUser[] } | { error: string }>;
  describeMessageReactions(
    instanceName: string,
    channelType: ChannelType,
    query: ReactionsQuery,
  ): Promise<MessageReactionsResult | { error: string }>;
  resolveSlackConversationLabels(
    refs: SlackConversationRef[],
  ): Promise<SlackLabelledConversation[]>;
  slackConversationStanding(
    slackChannelId: string,
    teamId: string,
  ): Promise<SlackConversationStanding>;
  slackChannelChoices(keycloakSub: string): Promise<SlackChannelChoices>;
  slackChannelMembership(
    keycloakSub: string,
    slackChannelId: string,
    teamId: string,
  ): Promise<SlackChannelMembership>;
  readThread(
    instanceName: string,
    channelType: ChannelType,
    query: ThreadQuery,
  ): Promise<ThreadResult | { error: string }>;
  fetchAttachment(
    instanceName: string,
    channelType: ChannelType,
    query: AttachmentQuery,
  ): Promise<AttachmentResult | { error: string }>;
  notifyPerson(
    keycloakSub: string,
    notice: PersonNotice,
  ): Promise<{ sent: number }>;
}

const ADDRESSED_METHODS = [
  "react",
  "declineTurn",
  "handOffTurn",
  "describeUsers",
  "describeMessageReactions",
  "readThread",
  "fetchAttachment",
] as const;

type AddressedMethod = (typeof ADDRESSED_METHODS)[number];

const METHOD_NAMES = [
  "listConversations",
  "postMessage",
  "reply",
  ...ADDRESSED_METHODS,
  "resolveConversationLabels",
  "slackConversationStanding",
  "slackChannelChoices",
  "slackChannelMembership",
  "notifyPerson",
] as const;

export const channelRpcRequestSchema = z.object({
  method: z.enum(METHOD_NAMES),
  args: z.array(z.unknown()),
});
export type ChannelRpcRequest = z.infer<typeof channelRpcRequestSchema>;

const forInstance = z.tuple([z.string(), z.enum(ChannelType)]);
const slackConversationRefSchema = z.object({
  channelId: z.string(),
  teamId: z.string(),
});
const slackConversationLabelSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("channel"), name: z.string() }),
  z.object({ kind: z.literal("direct-message"), with: z.string().nullable() }),
  z.object({
    kind: z.literal("group-direct-message"),
    members: z.array(z.string()),
  }),
  z.object({ kind: z.literal("gone") }),
]);
const rpcArgSchemas: Record<ChannelRpcRequest["method"], z.ZodTypeAny> = {
  listConversations: forInstance,
  postMessage: forInstance.rest(z.unknown()),
  reply: forInstance.rest(z.unknown()),
  react: forInstance.rest(z.unknown()),
  declineTurn: forInstance.rest(z.unknown()),
  handOffTurn: forInstance.rest(z.unknown()),
  describeUsers: forInstance.rest(z.unknown()),
  describeMessageReactions: forInstance.rest(z.unknown()),
  resolveConversationLabels: z.tuple([z.array(slackConversationRefSchema)]),
  slackConversationStanding: z.tuple([z.string(), z.string()]),
  slackChannelChoices: z.tuple([z.string()]),
  slackChannelMembership: z.tuple([z.string(), z.string(), z.string()]),
  readThread: forInstance.rest(z.unknown()),
  fetchAttachment: forInstance.rest(z.unknown()),
  notifyPerson: z.tuple([
    z.string(),
    z.object({ slack: z.string(), telegram: z.string().optional() }),
  ]),
};

const TRANSPORT_RETRY_MS = 60_000;

const okOrErrorSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ error: z.string() }),
]);
const rpcResponseSchemas: Record<ChannelRpcRequest["method"], z.ZodTypeAny> = {
  listConversations: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      profileId: z.string().nullish(),
    }),
  ),
  postMessage: sendResultSchema,
  reply: sendResultSchema,
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
    messageReactionsResultSchema,
    z.object({ error: z.string() }),
  ]),
  resolveConversationLabels: z.array(
    slackConversationRefSchema.extend({
      label: slackConversationLabelSchema.nullable(),
    }),
  ),
  slackConversationStanding: z.enum(["member", "known", "unknown"]),
  slackChannelChoices: z.discriminatedUnion("linked", [
    z.object({ linked: z.literal(false) }),
    z.object({
      linked: z.literal(true),
      channels: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          teamId: z.string(),
          isPrivate: z.boolean(),
        }),
      ),
    }),
  ]),
  slackChannelMembership: z.enum(["member", "not-member", "unlinked"]),
  readThread: z.union([threadResultSchema, z.object({ error: z.string() })]),
  fetchAttachment: z.union([
    attachmentResultSchema,
    z.object({ error: z.string() }),
  ]),
  notifyPerson: z.object({ sent: z.number() }),
};

const unsupported: Record<
  AddressedMethod,
  (channelType: ChannelType) => unknown
> = {
  react: (channelType) => ({
    error: `reactions not supported on ${channelType}`,
  }),
  declineTurn: () => ({ ok: true }),
  handOffTurn: (channelType) => ({
    error: `handing a turn to another agent is not supported on ${channelType}`,
  }),
  describeUsers: (channelType) => ({
    error: `user lookup not supported on ${channelType}`,
  }),
  describeMessageReactions: (channelType) => ({
    error: `message reactions not supported on ${channelType}`,
  }),
  readThread: (channelType) => ({
    error: `thread reads are not supported on ${channelType}`,
  }),
  fetchAttachment: (channelType) => ({
    error: `attachment fetches are not supported on ${channelType}`,
  }),
};

type Worker = ChannelWorker & Partial<AddressedWorker>;

type LocalHandlers = Record<
  ChannelRpcRequest["method"],
  (...args: never[]) => Promise<unknown>
>;

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
      (ChannelAttachment & Partial<WireAttachment>) | undefined;
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

  const explicitHandlers = {
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
    resolveConversationLabels: (refs: SlackConversationRef[]) =>
      slackWorker?.resolveConversationLabels?.(refs) ?? Promise.resolve([]),
    slackConversationStanding: (
      slackChannelId: string,
      teamId: string,
    ): Promise<SlackConversationStanding> =>
      deps.slackWorker
        ? deps.slackWorker.conversationStanding(slackChannelId, teamId)
        : Promise.reject(new Error("slack worker not available")),
    slackChannelChoices: (keycloakSub: string): Promise<SlackChannelChoices> =>
      deps.slackWorker
        ? deps.slackWorker.channelChoices(keycloakSub)
        : Promise.resolve({ linked: false }),
    slackChannelMembership: (
      keycloakSub: string,
      slackChannelId: string,
      teamId: string,
    ): Promise<SlackChannelMembership> =>
      deps.slackWorker
        ? deps.slackWorker.channelMembership(
            keycloakSub,
            slackChannelId,
            teamId,
          )
        : Promise.reject(new Error("slack worker not available")),
    notifyPerson: async (keycloakSub: string, notice: PersonNotice) => {
      const { telegram } = notice;
      const results = await Promise.all([
        slackWorker?.notifyPerson(keycloakSub, notice.slack) ?? { sent: 0 },
        telegram !== undefined && telegramWorker
          ? telegramWorker
              .notifyPerson(keycloakSub, telegram)
              .catch((err: unknown) => {
                process.stderr.write(
                  `[channels] could not notify ${keycloakSub} in Telegram: ${err instanceof Error ? err.message : String(err)}\n`,
                );
                return { sent: 0 };
              })
          : { sent: 0 },
      ]);
      return { sent: results.reduce((sum, r) => sum + r.sent, 0) };
    },
  };

  const addressedHandlers = Object.fromEntries(
    ADDRESSED_METHODS.map((method) => [
      method,
      async (
        instanceName: unknown,
        channelType: unknown,
        ...args: unknown[]
      ) => {
        const worker = workers.find((w) => w.type === channelType);
        const member = worker as
          | Record<string, ((...a: unknown[]) => Promise<unknown>) | undefined>
          | undefined;
        const call = member?.[method];
        return call
          ? call(instanceName, ...args)
          : unsupported[method](channelType as ChannelType);
      },
    ]),
  ) as Record<AddressedMethod, (...args: unknown[]) => Promise<unknown>>;

  const localHandlers: LocalHandlers = {
    ...explicitHandlers,
    ...addressedHandlers,
  };

  subscriptions.push(
    events$()
      .pipe(ofType<SlackConnected>(EventType.SlackConnected))
      .subscribe((event) => {
        if (slackWorker && isLeader()) {
          slackWorker.start(event.agentId);
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

  const dispatched =
    (method: ChannelRpcRequest["method"]) =>
    (...args: unknown[]) =>
      dispatchResult(method, args, () =>
        (localHandlers[method] as (...a: unknown[]) => Promise<unknown>)(
          ...args,
        ),
      );

  const addressedFacade = Object.fromEntries(
    ADDRESSED_METHODS.map((method) => [method, dispatched(method)]),
  ) as unknown as Pick<ChannelManager, AddressedMethod>;

  const manager: ChannelManager = {
    ...addressedFacade,
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
          const handler = localHandlers[req.method];
          if (!handler)
            throw new Error(`unknown channel rpc method ${req.method}`);
          return handler(
            ...(rpcArgSchemas[req.method].parse(req.args) as never[]),
          );
        });
      }

      await startTransports(generationAtStart);

      for (const [agentId, channels] of channelsByInstance) {
        for (const channel of channels) {
          if (generationAtStart !== generation) return;
          if (channel.type === ChannelType.Slack && slackWorker) {
            await slackWorker.start(agentId);
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
        explicitHandlers.listConversations(instanceName, channelType),
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
          explicitHandlers.postMessage(
            instanceName,
            channelType,
            text,
            options,
          ),
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
        () => explicitHandlers.reply(instanceName, channelType, replyArgs),
      );
    },

    resolveSlackConversationLabels(refs) {
      return dispatch("resolveConversationLabels", [refs], () =>
        explicitHandlers.resolveConversationLabels(refs),
      ).catch(() => []);
    },

    slackConversationStanding(slackChannelId, teamId) {
      return dispatch(
        "slackConversationStanding",
        [slackChannelId, teamId],
        () =>
          explicitHandlers.slackConversationStanding(slackChannelId, teamId),
      );
    },

    slackChannelChoices(keycloakSub) {
      return dispatch("slackChannelChoices", [keycloakSub], () =>
        explicitHandlers.slackChannelChoices(keycloakSub),
      );
    },

    slackChannelMembership(keycloakSub, slackChannelId, teamId) {
      return dispatch(
        "slackChannelMembership",
        [keycloakSub, slackChannelId, teamId],
        () =>
          explicitHandlers.slackChannelMembership(
            keycloakSub,
            slackChannelId,
            teamId,
          ),
      );
    },

    notifyPerson(keycloakSub, notice) {
      return dispatch("notifyPerson", [keycloakSub, notice], () =>
        explicitHandlers.notifyPerson(keycloakSub, notice),
      ).catch((err: unknown) => {
        process.stderr.write(
          `[channels] could not notify ${keycloakSub}: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        return { sent: 0 };
      });
    },
  };

  return manager;
}
