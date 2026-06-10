import { App, LogLevel } from "@slack/bolt";
import { formatError } from "../../../core/format-error.js";
import type {
  SlackGateway,
  SlackGatewayHandlers,
  SlackImageFile,
  SlackMessage,
} from "./slack-gateway.js";

type BoltApp = InstanceType<typeof App>;
type ChatPostMessageArgs = Parameters<
  BoltApp["client"]["chat"]["postMessage"]
>[0];

export interface BoltSlackGatewayDeps {
  botToken: string;
  appToken: string;
  commandName: string;
}

export function createBoltSlackGateway(
  deps: BoltSlackGatewayDeps,
): SlackGateway {
  let app: BoltApp | null = null;

  return {
    async start(handlers: SlackGatewayHandlers): Promise<boolean> {
      if (app) return true;

      const bolt = new App({
        token: deps.botToken,
        appToken: deps.appToken,
        socketMode: true,
        logLevel: LogLevel.DEBUG,
      });

      bolt.event("app_mention", async ({ event }) => {
        await handlers.onMention({
          user: event.user,
          channel: event.channel,
          ts: event.ts,
          threadTs: event.thread_ts,
          text: event.text ?? "",
          files: (event as { files?: SlackImageFile[] }).files,
        });
      });

      bolt.command(deps.commandName, async ({ command, ack }) => {
        await handlers.onCommand(
          {
            text: command.text,
            userId: command.user_id,
            channelId: command.channel_id,
          },
          (response) =>
            ack({ response_type: "ephemeral", text: response.text }),
        );
      });

      bolt.error(async (error) => {
        process.stderr.write(`[slack] Bolt error: ${error}\n`);
      });

      try {
        await bolt.start();
      } catch (err) {
        process.stderr.write(
          `[slack] Failed to start Slack bot: ${formatError(err)}\n`,
        );
        return false;
      }

      app = bolt;
      return true;
    },

    async stop() {
      if (app) {
        await app.stop();
        app = null;
      }
    },

    async postMessage(args) {
      if (!app) return;
      await app.client.chat.postMessage({
        channel: args.channel,
        text: args.text,
        thread_ts: args.threadTs,
        blocks: args.blocks,
      } as ChatPostMessageArgs);
    },

    async postEphemeral(args) {
      if (!app) return;
      await app.client.chat.postEphemeral({
        channel: args.channel,
        user: args.user,
        thread_ts: args.threadTs,
        text: args.text,
      });
    },

    async addReaction(args) {
      if (!app) return;
      await app.client.reactions.add({
        channel: args.channel,
        timestamp: args.ts,
        name: args.name,
      });
    },

    async getThreadReplies(args): Promise<SlackMessage[]> {
      if (!app) return [];
      const replies = await app.client.conversations.replies({
        channel: args.channel,
        ts: args.threadTs,
        limit: args.limit,
      });
      return (replies.messages ?? []).map((m) => ({
        ts: m.ts,
        user: m.user,
        text: m.text,
      }));
    },

    async getChannelHistory(args): Promise<SlackMessage[]> {
      if (!app) return [];
      const history = await app.client.conversations.history({
        channel: args.channel,
        limit: args.limit,
      });
      return (history.messages ?? []).map((m) => ({
        ts: m.ts,
        user: m.user,
        text: m.text,
      }));
    },

    async uploadFile(args) {
      if (!app) return;
      await app.client.files.uploadV2({
        channel_id: args.channelId,
        file: args.file,
        filename: args.filename,
        title: args.title,
        initial_comment: args.initialComment,
      });
    },

    async downloadFile(urlPrivate: string): Promise<ArrayBuffer> {
      const res = await fetch(urlPrivate, {
        headers: { Authorization: `Bearer ${deps.botToken}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.arrayBuffer();
    },
  };
}
