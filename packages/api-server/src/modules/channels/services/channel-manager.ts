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

/** One emoji reaction on a message: the emoji's short name, how many people
 *  used it, and which messenger user ids did. */
export interface ChannelMessageReaction {
  name: string;
  count: number;
  users: string[];
}

/** Which message to inspect for reactions. Same addressing as ChannelReaction
 *  minus the emoji: conversationId defaults to the bound channel, messageTs to
 *  the sole in-flight turn's message. */
export interface ReactionsQuery {
  conversationId?: string;
  messageTs?: string;
}

/** Reactions on one message, plus the conversation and message they were
 *  resolved against — the caller's query is often left to default (the bound
 *  channel, the current turn's message), so the resolved ids are what the
 *  caller should audit and surface, not the (possibly empty) request. */
export interface MessageReactionsResult {
  reactions: ChannelMessageReaction[];
  conversationId: string;
  messageTs: string;
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
  /** False only when this worker has confirmed a lookup can't succeed (e.g. a
   *  missing Slack scope). Absent on workers with no directory to begin with
   *  (Telegram) — those already refuse `describeUsers` on their own. */
  supportsUserLookup?(): Promise<boolean>;
  describeMessageReactions?(
    instanceName: string,
    query: ReactionsQuery,
  ): Promise<MessageReactionsResult | { error: string }>;
  /** False only when this worker has confirmed a lookup can't succeed (e.g. a
   *  missing Slack scope). Absent on workers with nothing to ask (Telegram). */
  supportsMessageReactions?(): Promise<boolean>;
}

export interface ChannelManager {
  availableChannels(): Partial<Record<ChannelType, boolean>>;
  /** Platform Telegram bot handle (no @), or null when Telegram is off. */
  telegramBotUsername(): string | null;
  /** Start the workers and serve the cross-replica rpc. Called only on the
   *  replica holding the channel lease. */
  bootstrap(channelsByInstance: Map<string, ChannelConfig[]>): Promise<void>;
  /** Reverse of {@link bootstrap} for a lost lease: stops the workers and
   *  the rpc server, but leaves the lifecycle-event subscriptions in place
   *  (they are leader-guarded, and this replica may win the lease again). */
  standDown(): Promise<void>;
  /** Process shutdown: {@link standDown} plus the event subscriptions. */
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
  /** Whether describe_channel_users could plausibly resolve anything right
   *  now, across every channel type. False only when every worker that
   *  implements a directory lookup has confirmed it can't (a missing
   *  optional scope) — an install with no such worker at all, or one whose
   *  capability is unknown, fails open so the tool stays registered exactly
   *  as it always has. */
  supportsUserLookup(): Promise<boolean>;
  /** Who reacted to a message, and with what emoji. */
  describeMessageReactions(
    instanceName: string,
    channelType: ChannelType,
    query: ReactionsQuery,
  ): Promise<MessageReactionsResult | { error: string }>;
  /** Whether describe_message_reactions could plausibly resolve anything
   *  right now, across every channel type — same fail-open semantics as
   *  supportsUserLookup. */
  supportsMessageReactions(): Promise<boolean>;
}

/** An outbound channel call marshalled to the worker-holding replica. The
 *  method names mirror the `Worker` surface one-for-one. */
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

export function createChannelManager(deps: {
  slackWorker?: SlackWorker;
  telegramWorker?: TelegramWorker;
  /** Cross-replica hop to the leader. Omitted, every call runs locally —
   *  the single-replica shape, and what the tests use. */
  rpc?: BusRpc<ChannelRpcRequest, unknown>;
  /** Whether this replica holds the channel lease. Omitted, always true. */
  isLeader?: () => boolean;
}): ChannelManager {
  const { slackWorker, telegramWorker, rpc } = deps;
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

  // Outbound work runs where the workers run. On the leader that is here; on
  // any other replica it is one bus hop away. Without an rpc hop configured
  // the local path is all there is.
  async function dispatch<T>(
    method: ChannelRpcRequest["method"],
    args: unknown[],
    local: () => Promise<T>,
  ): Promise<T> {
    if (isLeader() || !rpc) return local();
    return rpc.call({ method, args }) as Promise<T>;
  }

  /** `dispatch` for the calls whose contract is a `{ ok } | { error }` union.
   *  A failed hop (no leader mid-election, a leader that died with the call in
   *  flight) becomes an `error` result rather than a rejection: every caller
   *  branches on `"error" in result`, and for the MCP tools this is what turns
   *  a lost hop into a message the agent can act on. Deliberately not retried
   *  — a replayed post could double-post into a conversation. */
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

  /** The local half of every dispatch — also what the leader's rpc server
   *  runs for calls handed over from other replicas. */
  const localHandlers = {
    listConversations: (instanceName: string, channelType: ChannelType) => {
      const worker = workers.find((w) => w.type === channelType);
      if (!worker) return Promise.resolve([]);
      return worker.listConversations(instanceName);
    },
    postMessage: (
      instanceName: string,
      channelType: ChannelType,
      text: string,
      options?: PostMessageOptions,
    ) => {
      const worker = workers.find((w) => w.type === channelType);
      if (!worker)
        return Promise.resolve({
          error: `channel type ${channelType} not available`,
        });
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

  // Slack's per-agent registration is a no-op today (bindings resolve from
  // Postgres on every event), but `start` still opens the socket lazily —
  // so a bind served by a non-leader must not touch the worker, or that
  // replica ends up with a second Socket Mode connection taking events the
  // leader's turn state can't see.
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
        // Telegram bindings are rows, not runtime state — the channel-cleanup
        // saga deletes them; only Slack tracks per-agent worker state.
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
      // Called only on the replica holding the channel lease — the workers
      // are single-holder by construction (Slack Socket Mode fans each event
      // to one connection; Telegram admits one getUpdates consumer), and
      // every piece of per-turn state in them is in-process.
      //
      // Serving the rpc starts here so the hop is live for exactly as long
      // as the workers behind it are.
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

    standDown,

    async stopAll() {
      for (const sub of subscriptions) sub.unsubscribe();
      await standDown();
    },

    listConversations(instanceName, channelType) {
      // Degrades to "no conversations" on a failed hop, matching what a
      // missing worker already returns — this feeds a discovery listing, not
      // a delivery path.
      return dispatch("listConversations", [instanceName, channelType], () =>
        localHandlers.listConversations(instanceName, channelType),
      ).catch(() => []);
    },

    postMessage(instanceName, channelType, text, options) {
      return dispatchResult(
        "postMessage",
        [instanceName, channelType, text, options],
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
      // Fails open like the local path: a leader that is mid-election or
      // unreachable must not strip the tool off every agent's MCP surface.
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
