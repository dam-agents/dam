import { App, LogLevel } from "@slack/bolt";
import { formatError } from "../../../core/format-error.js";
import type {
  SlackChannelInfo,
  SlackGateway,
  SlackGatewayHandlers,
  SlackImageFile,
  SlackMessage,
  SlackMessageReaction,
  SlackUserInfo,
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
  // Scopes only change on a reinstall, which restarts this process — one
  // successful probe is good for the gateway's lifetime.
  let grantedScopes: Set<string> | null = null;

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
          channelType: (event as { channel_type?: string }).channel_type,
        });
      });

      bolt.event("message", async ({ event, context }) => {
        // Deliver only plain human messages. Bot posts (including the agent's
        // own replies) are skipped to prevent loops; edits/joins/etc. carry a
        // subtype (file_share excepted — that's a plain message with an
        // upload); and a message that mentions the bot already arrives via
        // app_mention.
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
        if (msg.subtype !== undefined && msg.subtype !== "file_share") return;
        if (msg.bot_id || !msg.user) return;
        const payload = {
          user: msg.user,
          channel: msg.channel,
          ts: msg.ts,
          threadTs: msg.thread_ts,
          text: msg.text ?? "",
          files: msg.files,
          channelType: msg.channel_type,
        };
        // A 1:1 DM (im) is always addressed to the bot, so every message
        // relays — including one that @mentions the bot. Route it before the
        // bot-mention drop below: that drop only dedups the channel/group case
        // against app_mention, and the worker ignores the duplicate
        // app_mention for DMs.
        if (msg.channel_type === "im") {
          await handlers.onDirectMessage(payload);
          return;
        }
        // channel/group: a message that @mentions the bot already arrives via
        // app_mention — skip it here to avoid processing the turn twice.
        const botUserId = context.botUserId;
        if (botUserId && (msg.text ?? "").includes(`<@${botUserId}>`)) return;
        // Plain channel/group messages feed ambient read-along; mpim (group
        // DM) is mention-driven (arrives via app_mention), so its plain
        // messages are ignored here.
        if (msg.channel_type === "channel" || msg.channel_type === "group") {
          await handlers.onMessage(payload);
        }
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
        grantedScopes = null;
      }
    },

    async postMessage(args) {
      if (!app) return;
      await app.client.chat.postMessage({
        channel: args.channel,
        text: args.text,
        thread_ts: args.threadTs,
        blocks: args.blocks,
        // Sent only when broadcasting: Slack's own arg type pairs
        // `reply_broadcast` with a definite `thread_ts`, so an unset flag stays
        // off the payload entirely rather than riding along as undefined.
        ...(args.replyBroadcast ? { reply_broadcast: true } : {}),
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
        blocks: m.blocks as SlackMessage["blocks"],
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
        blocks: m.blocks as SlackMessage["blocks"],
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

    async getUserInfo(userId: string): Promise<SlackUserInfo | null> {
      if (!app) return null;
      let info;
      try {
        info = await app.client.users.info({ user: userId });
      } catch (err) {
        // A wrong or foreign id is a lookup miss, not a gateway fault — the
        // caller reports it per id and keeps the rest of the batch.
        if (formatError(err).includes("user_not_found")) return null;
        throw err;
      }
      const user = info.user;
      if (!user?.id) return null;
      const profile = user.profile ?? {};
      return {
        id: user.id,
        ...(user.name ? { username: user.name } : {}),
        ...(user.real_name || profile.real_name
          ? { realName: user.real_name ?? profile.real_name }
          : {}),
        ...(profile.display_name ? { displayName: profile.display_name } : {}),
        ...(profile.title ? { title: profile.title } : {}),
        ...(profile.pronouns ? { pronouns: profile.pronouns } : {}),
        ...(profile.email ? { email: profile.email } : {}),
        ...(user.tz ? { timezone: user.tz } : {}),
        ...(user.tz_label ? { timezoneLabel: user.tz_label } : {}),
        ...(profile.status_text ? { statusText: profile.status_text } : {}),
        ...(profile.status_emoji ? { statusEmoji: profile.status_emoji } : {}),
        ...(user.is_bot !== undefined ? { isBot: user.is_bot } : {}),
        ...(user.deleted !== undefined ? { isDeleted: user.deleted } : {}),
      };
    },

    async getMessageReactions(
      channel: string,
      ts: string,
    ): Promise<SlackMessageReaction[] | null> {
      if (!app) return null;
      let result;
      try {
        result = await app.client.reactions.get({
          channel,
          timestamp: ts,
          full: true,
        });
      } catch (err) {
        // A ts Slack can't find is a lookup miss, not a gateway fault.
        if (formatError(err).includes("message_not_found")) return null;
        throw err;
      }
      return (result.message?.reactions ?? []).map((r) => ({
        name: r.name ?? "",
        count: r.count ?? 0,
        users: r.users ?? [],
      }));
    },

    async openDirectMessage(userId: string): Promise<string> {
      if (!app) throw new Error("slack bot not running");
      const opened = await app.client.conversations.open({ users: userId });
      const id = opened.channel?.id;
      if (!id) throw new Error("Slack returned no conversation id");
      return id;
    },

    async getGrantedScopes(): Promise<Set<string> | null> {
      if (!app) return null;
      if (grantedScopes) return grantedScopes;
      try {
        // auth.test needs no scope of its own and has a generous rate limit;
        // it's a cheap way to ask Slack what the bot token can actually do.
        const result = await app.client.auth.test();
        const scopes = result.response_metadata?.scopes;
        if (scopes) grantedScopes = new Set(scopes);
        return grantedScopes;
      } catch {
        return null;
      }
    },
  };
}
