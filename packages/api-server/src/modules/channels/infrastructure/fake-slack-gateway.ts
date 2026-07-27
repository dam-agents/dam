import type { SlackOutboundRecord } from "api-server-api";
import type {
  SlackChannelMessageEvent,
  SlackGateway,
  SlackGatewayHandlers,
  SlackMentionEvent,
  SlackMessage,
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
  /** A plain (non-mention) channel message, as the real gateway would deliver
   *  it post-filtering: human-authored, no subtype, not a DM. */
  fireMessage(event: SlackChannelMessageEvent): Promise<void>;
  /** A plain message in a 1:1 DM (`message.im`), as the real gateway delivers
   *  it post-filtering: human-authored, no subtype, not a bot post. */
  fireDirectMessage(event: SlackChannelMessageEvent): Promise<void>;
  fireCommand(command: SlackSlashCommand): Promise<string>;
  readOutbound(): SlackOutboundRecord[];
  resetOutbound(): void;
  /** Workspace channel directory; unlisted ids resolve as not found. */
  setChannels(channels: FakeSlackChannel[]): void;
  /** Seed the messages returned by getThreadReplies / getChannelHistory, so a
   *  test can exercise history injection (e.g. attribution footers). */
  setHistory(messages: SlackMessage[]): void;
  /** Workspace member directory; unlisted ids resolve as not found. */
  setUsers(users: SlackUserInfo[]): void;
  /** Every id getUserInfo was called with, in order — lets a test see the
   *  lookups that actually reached Slack (i.e. missed the worker's cache). */
  readUserLookups(): string[];
}

export function createFakeSlackGateway(): FakeSlackGateway {
  let handlers: SlackGatewayHandlers | null = null;
  const outbound: SlackOutboundRecord[] = [];
  let channels: FakeSlackChannel[] = [];
  let history: SlackMessage[] = [];
  let users: SlackUserInfo[] = [];
  const userLookups: string[] = [];
  let nextStreamTs = 1;

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

    async downloadFile() {
      throw new Error("downloadFile is not supported by the fake gateway");
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
  };
}
