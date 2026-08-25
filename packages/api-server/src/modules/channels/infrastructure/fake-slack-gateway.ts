import type { SlackOutboundRecord } from "api-server-api";
import { FileTooLargeError, THREAD_TAIL_MAX_PAGES } from "./slack-gateway.js";
import { foldTailPage } from "../domain/thread-catch-up.js";
import type {
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

export interface FakeSlackGateway extends SlackGateway {
  fireMention(event: SlackMentionEvent): Promise<void>;
  fireMessage(event: SlackChannelMessageEvent): Promise<void>;
  fireDirectMessage(event: SlackChannelMessageEvent): Promise<void>;
  fireCommand(command: SlackSlashCommand): Promise<string>;
  readOutbound(): SlackOutboundRecord[];
  resetOutbound(): void;
  setChannels(channels: FakeSlackChannel[]): void;
  setHistory(messages: SlackMessage[]): void;
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
 * because the thread parent rides along in every page.
 */
function pageOf(
  window: SlackMessage[],
  cursor: number,
  limit: number,
): { messages: SlackMessage[]; nextCursor: number | null } {
  const messages = window.slice(cursor, cursor + limit);
  const consumed = cursor + messages.length;
  return { messages, nextCursor: consumed < window.length ? consumed : null };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Models Slack's thread read, including the parts a
 * caller can get wrong. The thread parent comes back in every page whatever the
 * anchor, because the real API includes it, and an anchored read is a filter
 * over the rest rather than a fresh window.
 */
function threadWindowOf(
  history: SlackMessage[],
  oldest: string | undefined,
): SlackMessage[] {
  if (oldest === undefined) return [...history];
  return history.filter((m, i) => {
    if (i === 0) return true;
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
  let channels: FakeSlackChannel[] = [];
  let history: SlackMessage[] = [];
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
        channel: args.channel,
        ts: args.ts,
        text: args.markdownText,
      });
    },

    async stopStream(args) {
      outbound.push({
        kind: "stream_stop",
        channel: args.channel,
        ts: args.ts,
        ...(args.markdownText !== undefined ? { text: args.markdownText } : {}),
      });
    },

    async setStatus(args) {
      outbound.push({
        kind: "status",
        channel: args.channel,
        threadTs: args.threadTs,
        status: args.status,
      });
    },

    async addReaction(args) {
      outbound.push({
        kind: "reaction",
        channel: args.channel,
        ts: args.ts,
        name: args.name,
      });
    },

    async getThreadReplies(args) {
      const page = pageOf(threadWindowOf(history, args.oldest), 0, args.limit);
      return { messages: page.messages, hasMore: page.nextCursor !== null };
    },

    async getThreadTail(args) {
      const all = threadWindowOf(history, undefined);
      const maxPages = args.maxPages ?? THREAD_TAIL_MAX_PAGES;
      let window: SlackMessage[] = [];
      let cursor: number | null = 0;
      let stoppedShort = false;
      for (let read = 0; ; read += 1) {
        if (read >= maxPages) {
          stoppedShort = true;
          break;
        }
        const page = pageOf(all, cursor, args.limit);
        window = foldTailPage(window, page.messages, args.limit);
        cursor = page.nextCursor;
        if (cursor === null) break;
      }
      return { messages: window, hasMore: stoppedShort };
    },

    async getChannelHistory() {
      return [...history];
    },

    async uploadFile(args) {
      outbound.push({
        kind: "upload",
        channelId: args.channelId,
        filename: args.filename,
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

    async listBotChannels() {
      return channels
        .filter((c) => c.botIsMember)
        .map(({ id, name }) => ({ id, name }));
    },

    async getConversationInfo(channelId) {
      const channel = channels.find((c) => c.id === channelId);
      return channel ? { isMember: channel.botIsMember } : null;
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

    async fireMention(event) {
      await requireHandlers().onMention(event);
    },

    async fireMessage(event) {
      await requireHandlers().onMessage(event);
    },

    async fireDirectMessage(event) {
      await requireHandlers().onDirectMessage(event);
    },

    async fireCommand(command) {
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

    setChannels(next) {
      channels = [...next];
    },

    setHistory(next) {
      history = [...next];
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
