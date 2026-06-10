import type { SlackOutboundRecord } from "api-server-api";
import type {
  SlackGateway,
  SlackGatewayHandlers,
  SlackMentionEvent,
  SlackSlashCommand,
} from "./slack-gateway.js";

export interface FakeSlackGateway extends SlackGateway {
  fireMention(event: SlackMentionEvent): Promise<void>;
  fireCommand(command: SlackSlashCommand): Promise<string>;
  readOutbound(): SlackOutboundRecord[];
  resetOutbound(): void;
}

export function createFakeSlackGateway(): FakeSlackGateway {
  let handlers: SlackGatewayHandlers | null = null;
  const outbound: SlackOutboundRecord[] = [];

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

    async fireMention(event) {
      await requireHandlers().onMention(event);
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
  };
}
