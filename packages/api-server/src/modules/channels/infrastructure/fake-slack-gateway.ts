import type { SlackOutboundRecord } from "api-server-api";
import type {
  SlackChannelMessageEvent,
  SlackGateway,
  SlackGatewayHandlers,
  SlackMentionEvent,
  SlackSlashCommand,
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
  fireCommand(command: SlackSlashCommand): Promise<string>;
  readOutbound(): SlackOutboundRecord[];
  resetOutbound(): void;
  /** Workspace channel directory; unlisted ids resolve as not found. */
  setChannels(channels: FakeSlackChannel[]): void;
}

export function createFakeSlackGateway(): FakeSlackGateway {
  let handlers: SlackGatewayHandlers | null = null;
  const outbound: SlackOutboundRecord[] = [];
  let channels: FakeSlackChannel[] = [];

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

    async addReaction(args) {
      outbound.push({
        kind: "reaction",
        channel: args.channel,
        ts: args.ts,
        name: args.name,
      });
    },

    async getThreadReplies() {
      return [];
    },

    async getChannelHistory() {
      return [];
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

    async openDirectMessage(userId) {
      return `D-${userId}`;
    },

    async fireMention(event) {
      await requireHandlers().onMention(event);
    },

    async fireMessage(event) {
      await requireHandlers().onMessage(event);
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
  };
}
