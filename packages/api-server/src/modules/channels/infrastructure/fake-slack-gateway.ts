import type { SlackOutboundRecord } from "api-server-api";
import { FileTooLargeError, THREAD_TAIL_MAX_PAGES } from "./slack-gateway.js";
import { ORIGINAL_WORKSPACE } from "./slack-gateway.js";
import { emptyTailFold, foldTailPage } from "../domain/thread-catch-up.js";
import type {
  SlackBotJoinedChannelEvent,
  SlackChannelMessageEvent,
  SlackGateway,
  SlackGatewayHandlers,
  SlackMentionEvent,
  SlackMessage,
  SlackMessageReaction,
  SlackSlashCommand,
  SlackUserInfo,
} from "./slack-gateway.js";

export interface FakeSlackChannel {
  id: string;
  name: string;
  botIsMember: boolean;
}

export type FiredSlackEvent = Omit<SlackMentionEvent, "teamId"> & {
  teamId?: string;
};
export type FiredSlackCommand = Omit<SlackSlashCommand, "teamId"> & {
  teamId?: string;
};
export type FiredSlackBotJoin = Omit<SlackBotJoinedChannelEvent, "teamId"> & {
  teamId?: string;
};

export interface FakeSlackGateway extends SlackGateway {
  fireMention(event: FiredSlackEvent): Promise<void>;
  fireMessage(event: FiredSlackEvent): Promise<void>;
  fireDirectMessage(event: FiredSlackEvent): Promise<void>;
  fireCommand(command: FiredSlackCommand): Promise<string>;
  fireBotJoinedChannel(event: FiredSlackBotJoin): Promise<void>;
  readOutbound(): SlackOutboundRecord[];
  resetOutbound(): void;
  setChannels(channels: FakeSlackChannel[], teamId?: string): void;
  setHistory(messages: SlackMessage[]): void;
  setThreadedHistory(messages: SlackMessage[]): void;
  setUsers(users: SlackUserInfo[]): void;
  readUserLookups(): string[];
  setGrantedScopes(scopes: string[] | null): void;
  setBotUserId(id: string | null): void;
  setFileBytes(urlPrivate: string, bytes: Buffer): void;
  setMessageReactions(
    channel: string,
    ts: string,
    reactions: SlackMessageReaction[],
  ): void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: One page and the cursor that follows it. The
 * paging signal is page state — whether a next cursor exists — never a count of
 * the messages handed back, which the gateway contract forbids inferring from
 * because the thread parent rides along in every page. That repeat is modelled
 * on every page but the first, since a caller folding pages together has to
 * cope with it and would not see the need from a fake that tidied it away.
 */
function pageOf(
  window: SlackMessage[],
  cursor: number,
  limit: number,
): { messages: SlackMessage[]; nextCursor: number | null } {
  const parent = window[0];
  const repeatParent = cursor > 0 && parent !== undefined;
  const room = repeatParent ? limit - 1 : limit;
  const slice = window.slice(cursor, cursor + room);
  const consumed = cursor + slice.length;
  return {
    messages: repeatParent ? [parent, ...slice] : slice,
    nextCursor: consumed < window.length ? consumed : null,
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Models Slack's thread read, including the parts a
 * caller can get wrong. The thread parent comes back in every page whatever the
 * anchor, because the real API includes it, and an anchored read is a filter
 * over the rest rather than a fresh window. Whether a fixture models threads at
 * all is its own explicit choice, never read off its contents: setHistory means
 * the history is the thread, setThreadedHistory means reads are exact.
 */
function threadWindowOf(
  history: SlackMessage[],
  threadTs: string,
  oldest: string | undefined,
  modelsThreads: boolean,
): SlackMessage[] {
  const thread = modelsThreads
    ? history.filter((m) => m.ts === threadTs || m.threadTs === threadTs)
    : [...history];
  if (oldest === undefined) return [...thread];
  return thread.filter((m, i) => {
    if (i === 0) return true;
    if (m.ts === undefined) return true;
    const at = Number(m.ts);
    const floor = Number(oldest);
    if (!Number.isFinite(at) || !Number.isFinite(floor)) return true;
    return at >= floor;
  });
}

function hiddenInThread(m: SlackMessage): boolean {
  return (
    m.threadTs !== undefined &&
    m.threadTs !== m.ts &&
    m.subtype !== "thread_broadcast"
  );
}

function channelWindowOf(
  history: SlackMessage[],
  oldest: string | undefined,
  modelsThreads: boolean,
): SlackMessage[] {
  const topLevel = modelsThreads
    ? history.filter((m) => !hiddenInThread(m))
    : [...history];
  if (oldest === undefined) return [...topLevel];
  return topLevel.filter((m) => {
    if (m.ts === undefined) return true;
    const at = Number(m.ts);
    const floor = Number(oldest);
    if (!Number.isFinite(at) || !Number.isFinite(floor)) return true;
    return at >= floor;
  });
}

export function createFakeSlackGateway(): FakeSlackGateway {
  let handlers: SlackGatewayHandlers | null = null;
  const outbound: SlackOutboundRecord[] = [];
  const channelsByWorkspace = new Map<string, FakeSlackChannel[]>();
  let history: SlackMessage[] = [];
  let modelsThreads = false;
  let users: SlackUserInfo[] = [];
  const userLookups: string[] = [];
  let nextStreamTs = 1;
  let grantedScopes: Set<string> | null = null;
  let botUserId: string | null = "U-BOT";
  const messageReactions = new Map<string, SlackMessageReaction[]>();
  const fileBytes = new Map<string, Buffer>();

  function requireHandlers(): SlackGatewayHandlers {
    if (!handlers) {
      throw new Error(
        "fake slack gateway not started — connect a Slack channel first",
      );
    }
    return handlers;
  }

  return {
    async start(h) {
      handlers = h;
      return true;
    },

    async stop() {
      handlers = null;
    },

    async postMessage(args) {
      outbound.push({
        kind: "message",
        teamId: args.teamId,
        channel: args.channel,
        text: args.text,
        ...(args.threadTs !== undefined ? { threadTs: args.threadTs } : {}),
        ...(args.replyBroadcast !== undefined
          ? { replyBroadcast: args.replyBroadcast }
          : {}),
      });
    },

    async postEphemeral(args) {
      outbound.push({
        kind: "ephemeral",
        teamId: args.teamId,
        channel: args.channel,
        user: args.user,
        text: args.text,
        ...(args.threadTs !== undefined ? { threadTs: args.threadTs } : {}),
      });
    },

    async startStream(args) {
      const ts = `stream-${nextStreamTs++}`;
      outbound.push({
        kind: "stream_start",
        teamId: args.teamId,
        channel: args.channel,
        threadTs: args.threadTs,
        ts,
        text: args.markdownText ?? "",
        ...(args.recipientTeamId !== undefined
          ? { recipientTeamId: args.recipientTeamId }
          : {}),
        ...(args.recipientUserId !== undefined
          ? { recipientUserId: args.recipientUserId }
          : {}),
      });
      return { ts };
    },

    async appendStream(args) {
      outbound.push({
        kind: "stream_append",
        teamId: args.teamId,
        channel: args.channel,
        ts: args.ts,
        text: args.markdownText,
      });
    },

    async stopStream(args) {
      outbound.push({
        kind: "stream_stop",
        teamId: args.teamId,
        channel: args.channel,
        ts: args.ts,
        ...(args.markdownText !== undefined ? { text: args.markdownText } : {}),
      });
    },

    async setStatus(args) {
      outbound.push({
        kind: "status",
        teamId: args.teamId,
        channel: args.channel,
        threadTs: args.threadTs,
        status: args.status,
      });
    },

    async addReaction(args) {
      outbound.push({
        kind: "reaction",
        teamId: args.teamId,
        channel: args.channel,
        ts: args.ts,
        name: args.name,
      });
    },

    async getThreadReplies(args) {
      const page = pageOf(
        threadWindowOf(history, args.threadTs, args.oldest, modelsThreads),
        0,
        args.limit,
      );
      return { messages: page.messages, hasMore: page.nextCursor !== null };
    },

    async getThreadTail(args) {
      const all = threadWindowOf(
        history,
        args.threadTs,
        undefined,
        modelsThreads,
      );
      const maxPages = args.maxPages ?? THREAD_TAIL_MAX_PAGES;
      let fold = emptyTailFold<SlackMessage>();
      let cursor: number | null = 0;
      let stoppedShort = false;
      for (let read = 0; ; read += 1) {
        if (read >= maxPages) {
          stoppedShort = true;
          break;
        }
        const page = pageOf(all, cursor, args.limit);
        fold = foldTailPage(fold, page.messages, args.limit);
        cursor = page.nextCursor;
        if (cursor === null) break;
      }
      return { messages: fold.window, hasMore: stoppedShort };
    },

    async getChannelHistory(args) {
      const newestFirst = channelWindowOf(
        history,
        args.oldest,
        modelsThreads,
      ).reverse();
      return {
        messages: newestFirst.slice(0, args.limit),
        hasMore: newestFirst.length > args.limit,
      };
    },

    async uploadFile(args) {
      outbound.push({
        kind: "upload",
        teamId: args.teamId,
        channelId: args.channelId,
        filename: args.filename,
        ...(args.threadTs ? { threadTs: args.threadTs } : {}),
      });
    },

    async downloadFile(urlPrivate, maxBytes) {
      const bytes = fileBytes.get(urlPrivate);
      if (!bytes) throw new Error(`HTTP 404`);
      if (bytes.byteLength > maxBytes) {
        throw new FileTooLargeError(maxBytes);
      }
      return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
    },

    setFileBytes(urlPrivate, bytes) {
      fileBytes.set(urlPrivate, bytes);
    },

    async listBotChannels(teamId) {
      return (channelsByWorkspace.get(teamId) ?? [])
        .filter((c) => c.botIsMember)
        .map(({ id, name }) => ({ id, name }));
    },

    async getConversationInfo(channelId, teamId) {
      const channel = (channelsByWorkspace.get(teamId) ?? []).find(
        (c) => c.id === channelId,
      );
      return channel
        ? { isMember: channel.botIsMember, name: channel.name }
        : null;
    },

    async getUserInfo(userId) {
      userLookups.push(userId);
      return users.find((u) => u.id === userId) ?? null;
    },

    async getMessageReactions(channel, ts) {
      return messageReactions.get(`${channel}:${ts}`) ?? null;
    },

    async getPermalink(channel, ts) {
      return `https://fake-workspace.slack.com/archives/${channel}/p${ts.replace(".", "")}`;
    },

    async openDirectMessage(userId) {
      return `D-${userId}`;
    },

    async fireMention(input) {
      const event: SlackMentionEvent = {
        ...input,
        teamId: input.teamId ?? ORIGINAL_WORKSPACE,
      };
      await requireHandlers().onMention(event);
    },

    async fireMessage(input) {
      const event: SlackMentionEvent = {
        ...input,
        teamId: input.teamId ?? ORIGINAL_WORKSPACE,
      };
      await requireHandlers().onMessage(event);
    },

    async fireBotJoinedChannel(input) {
      await requireHandlers().onBotJoinedChannel({
        ...input,
        teamId: input.teamId ?? ORIGINAL_WORKSPACE,
      });
    },

    async fireDirectMessage(input) {
      const event: SlackMentionEvent = {
        ...input,
        teamId: input.teamId ?? ORIGINAL_WORKSPACE,
      };
      await requireHandlers().onDirectMessage(event);
    },

    async fireCommand(input) {
      const command: SlackSlashCommand = {
        ...input,
        teamId: input.teamId ?? ORIGINAL_WORKSPACE,
      };
      let ackText = "";
      await requireHandlers().onCommand(command, async ({ text }) => {
        ackText = text;
      });
      return ackText;
    },

    readOutbound() {
      return [...outbound];
    },

    resetOutbound() {
      outbound.length = 0;
    },

    setChannels(next, teamId = "") {
      channelsByWorkspace.set(teamId, [...next]);
    },

    setHistory(next) {
      history = [...next];
      modelsThreads = false;
    },

    setThreadedHistory(next) {
      history = [...next];
      modelsThreads = true;
    },

    setUsers(next) {
      users = [...next];
    },

    readUserLookups() {
      return [...userLookups];
    },

    async getGrantedScopes() {
      return grantedScopes;
    },

    async getBotUserId() {
      return botUserId;
    },

    setGrantedScopes(scopes) {
      grantedScopes = scopes ? new Set(scopes) : null;
    },

    setBotUserId(id) {
      botUserId = id;
    },

    setMessageReactions(channel, ts, reactions) {
      messageReactions.set(`${channel}:${ts}`, [...reactions]);
    },
  };
}
