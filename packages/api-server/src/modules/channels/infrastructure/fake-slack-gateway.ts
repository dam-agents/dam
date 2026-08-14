import type { SlackOutboundRecord } from "api-server-api";
import { FileTooLargeError } from "./slack-gateway.js";
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

    async getThreadReplies() {
      return [...history];
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
