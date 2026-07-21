import { App, LogLevel } from "@slack/bolt";
import { formatError } from "../../../core/format-error.js";
import type {
  SlackChannelInfo,
  SlackGateway,
  SlackGatewayHandlers,
  SlackImageFile,
  SlackMessage,
} from "./slack-gateway.js";

type BoltApp = InstanceType<typeof App>;
type ChatPostMessageArgs = Parameters<
  BoltApp["client"]["chat"]["postMessage"]
>[0];
type ChatStopStreamArgs = Parameters<
  BoltApp["client"]["chat"]["stopStream"]
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

      bolt.event("app_mention", async ({ event, context }) => {
        await handlers.onMention({
          user: event.user,
          channel: event.channel,
          ts: event.ts,
          threadTs: event.thread_ts,
          text: event.text ?? "",
          files: (event as { files?: SlackImageFile[] }).files,
          teamId: event.team ?? context.teamId,
        });
      });

      bolt.event("message", async ({ event, context }) => {
        // Ambient reading: deliver only plain human channel messages. Bot
        // posts (including the agent's own replies) are skipped to prevent
        // loops; edits/joins/etc. carry a subtype (file_share excepted —
        // that's a plain message with an upload); DMs are out of scope; and
        // a message that mentions the bot already arrives via app_mention.
        const msg = event as {
          channel: string;
          channel_type?: string;
          subtype?: string;
          bot_id?: string;
          user?: string;
          ts: string;
          thread_ts?: string;
          text?: string;
          files?: SlackImageFile[];
        };
        if (msg.channel_type !== "channel" && msg.channel_type !== "group")
          return;
        if (msg.subtype !== undefined && msg.subtype !== "file_share") return;
        if (msg.bot_id || !msg.user) return;
        const botUserId = context.botUserId;
        if (botUserId && (msg.text ?? "").includes(`<@${botUserId}>`)) return;
        await handlers.onMessage({
          user: msg.user,
          channel: msg.channel,
          ts: msg.ts,
          threadTs: msg.thread_ts,
          text: msg.text ?? "",
          files: msg.files,
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

    async startStream(args): Promise<{ ts: string }> {
      // Throw (not silent no-op) when the app isn't running or Slack rejects
      // the stream — the worker relies on the throw to fall back to a plain post.
      if (!app) throw new Error("slack app not started");
      const res = await app.client.chat.startStream({
        channel: args.channel,
        thread_ts: args.threadTs,
        recipient_team_id: args.recipientTeamId,
        recipient_user_id: args.recipientUserId,
        ...(args.markdownText !== undefined
          ? { markdown_text: args.markdownText }
          : {}),
      });
      if (!res.ts) throw new Error("chat.startStream returned no ts");
      return { ts: res.ts };
    },

    async appendStream(args) {
      if (!app) throw new Error("slack app not started");
      await app.client.chat.appendStream({
        channel: args.channel,
        ts: args.ts,
        markdown_text: args.markdownText,
      });
    },

    async stopStream(args) {
      if (!app) throw new Error("slack app not started");
      await app.client.chat.stopStream({
        channel: args.channel,
        ts: args.ts,
        ...(args.markdownText !== undefined
          ? { markdown_text: args.markdownText }
          : {}),
        ...(args.blocks !== undefined ? { blocks: args.blocks } : {}),
      } as ChatStopStreamArgs);
    },

    async setStatus(args) {
      if (!app) throw new Error("slack app not started");
      await app.client.assistant.threads.setStatus({
        channel_id: args.channel,
        thread_ts: args.threadTs,
        status: args.status,
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

    async listBotChannels(): Promise<SlackChannelInfo[]> {
      if (!app) return [];
      const channels: SlackChannelInfo[] = [];
      let cursor: string | undefined;
      do {
        const page = await app.client.users.conversations({
          types: "public_channel,private_channel",
          exclude_archived: true,
          limit: 200,
          cursor,
        });
        for (const c of page.channels ?? []) {
          if (c.id) channels.push({ id: c.id, name: c.name ?? c.id });
        }
        cursor = page.response_metadata?.next_cursor || undefined;
      } while (cursor);
      return channels;
    },

    async getConversationInfo(channelId: string) {
      if (!app) return null;
      try {
        const info = await app.client.conversations.info({
          channel: channelId,
        });
        if (!info.channel) return null;
        return { isMember: !!info.channel.is_member };
      } catch (err) {
        if (formatError(err).includes("channel_not_found")) return null;
        throw err;
      }
    },

    async openDirectMessage(userId: string): Promise<string> {
      if (!app) throw new Error("slack bot not running");
      const opened = await app.client.conversations.open({ users: userId });
      const id = opened.channel?.id;
      if (!id) throw new Error("Slack returned no conversation id");
      return id;
    },
  };
}
