import { App, LogLevel } from "@slack/bolt";
import { formatError } from "../../../core/format-error.js";
import {
  FileTooLargeError,
  ORIGINAL_WORKSPACE,
  THREAD_TAIL_MAX_PAGES,
} from "./slack-gateway.js";
import { emptyTailFold, foldTailPage } from "../domain/thread-catch-up.js";
import type {
  SlackChannelInfo,
  SlackGateway,
  SlackGatewayHandlers,
  SlackImageFile,
  SlackMessage,
  SlackMessageReaction,
  SlackTokenResolver,
  SlackUserInfo,
  SlackWorkspace,
} from "./slack-gateway.js";

type BoltApp = InstanceType<typeof App>;
type ChatPostMessageArgs = Parameters<
  BoltApp["client"]["chat"]["postMessage"]
>[0];
type ChatStopStreamArgs = Parameters<
  BoltApp["client"]["chat"]["stopStream"]
>[0];

export interface BoltSlackGatewayDeps {
  resolveBotToken: SlackTokenResolver;
  setOriginalWorkspace: (teamId: SlackWorkspace) => void;
  appToken: string;
  commandName: string;
  onCredentialRejected: (teamId: string) => Promise<void>;
}

interface WorkspaceAuth {
  token: string;
  botUserId: string | null;
  scopes: Set<string> | null;
  tested: Promise<void> | null;
}

const CHANNEL_HISTORY_PAGE_SIZE = 200;
const INSTALL_TOKEN_MISSING = "slack workspace is not installed";

function toSlackMessage(m: {
  ts?: string;
  user?: string;
  text?: string;
  blocks?: unknown;
  edited?: unknown;
}): SlackMessage {
  return {
    ts: m.ts,
    user: m.user,
    text: m.text,
    blocks: m.blocks as SlackMessage["blocks"],
    ...(m.edited ? { edited: true } : {}),
  };
}

export function createBoltSlackGateway(
  deps: BoltSlackGatewayDeps,
): SlackGateway {
  let app: BoltApp | null = null;
  const workspaces = new Map<string, WorkspaceAuth>();

  async function authFor(
    teamId: SlackWorkspace,
  ): Promise<WorkspaceAuth | null> {
    const token = await deps.resolveBotToken(teamId);
    if (!token) return null;
    const cached = workspaces.get(teamId);
    if (cached?.token === token) return cached;
    const fresh: WorkspaceAuth = {
      token,
      botUserId: null,
      scopes: null,
      tested: null,
    };
    workspaces.set(teamId, fresh);
    return fresh;
  }

  async function tokenFor(teamId: SlackWorkspace): Promise<string | null> {
    return (await authFor(teamId))?.token ?? null;
  }

  async function testedAuthFor(
    teamId: SlackWorkspace,
  ): Promise<WorkspaceAuth | null> {
    const auth = await authFor(teamId);
    if (!auth || !app) return auth;
    const pending = (auth.tested ??= (async () => {
      try {
        const result = await app!.client.auth.test({ token: auth.token });
        const scopes = result.response_metadata?.scopes;
        if (scopes) auth.scopes = new Set(scopes);
        if (typeof result.user_id === "string") auth.botUserId = result.user_id;
      } catch {
        auth.tested = null;
      }
    })());
    await pending;
    return auth;
  }

  /**
   * UNIT_BOUNDARY_DESCRIPTION: Which workspace the operator's credential
   * belongs to. Slack names that workspace on every event it sends, while the
   * bindings made before this platform could connect a second workspace name it
   * by the empty string, and both have to reach one credential. A workspace
   * connected over OAuth needs none of this — Slack returns its id beside its
   * token — so this is asked once, for the one credential that arrives without
   * its workspace. It is asked before the socket opens, so no message is ever
   * served while the answer is unknown, and a failure to learn it is a failure
   * to start, which the worker already retries.
   */
  async function learnOriginalWorkspace(bolt: BoltApp): Promise<void> {
    const envToken = await deps.resolveBotToken(ORIGINAL_WORKSPACE);
    if (!envToken) throw new Error("no bot token for the original workspace");
    const identity = await bolt.client.auth.test({ token: envToken });
    if (typeof identity.team_id !== "string") {
      throw new Error("Slack did not name the original workspace");
    }
    deps.setOriginalWorkspace(identity.team_id);
  }

  return {
    async start(handlers: SlackGatewayHandlers): Promise<boolean> {
      if (app) return true;

      const bolt = new App({
        appToken: deps.appToken,
        socketMode: true,
        logLevel: LogLevel.DEBUG,
        authorize: async ({ teamId }) => {
          const auth = await testedAuthFor(teamId ?? ORIGINAL_WORKSPACE);
          if (!auth) throw new Error(`${INSTALL_TOKEN_MISSING}: ${teamId}`);
          return {
            botToken: auth.token,
            ...(auth.botUserId ? { botUserId: auth.botUserId } : {}),
          };
        },
      });

      bolt.event("app_mention", async ({ event, context }) => {
        await handlers.onMention({
          user: event.user,
          channel: event.channel,
          ts: event.ts,
          threadTs: event.thread_ts,
          text: event.text ?? "",
          files: (event as { files?: SlackImageFile[] }).files,
          teamId: event.team ?? context.teamId ?? ORIGINAL_WORKSPACE,
          channelType: (event as { channel_type?: string }).channel_type,
        });
      });

      bolt.event("message", async ({ event, context }) => {
        const msg = event as {
          channel: string;
          channel_type?: string;
          subtype?: string;
          bot_id?: string;
          user?: string;
          ts: string;
          thread_ts?: string;
          text?: string;
          team?: string;
          files?: SlackImageFile[];
        };
        if (msg.subtype !== undefined && msg.subtype !== "file_share") return;
        if (msg.bot_id || !msg.user) return;
        const workspace = msg.team ?? context.teamId ?? ORIGINAL_WORKSPACE;
        const payload = {
          user: msg.user,
          channel: msg.channel,
          ts: msg.ts,
          threadTs: msg.thread_ts,
          text: msg.text ?? "",
          files: msg.files,
          teamId: workspace,
          channelType: msg.channel_type,
        };
        if (msg.channel_type === "im") {
          await handlers.onDirectMessage(payload);
          return;
        }
        const text = msg.text ?? "";
        const selfId =
          context.botUserId ?? (await testedAuthFor(workspace))?.botUserId;
        if (selfId && text.includes(`<@${selfId}>`)) return;
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
            teamId: command.team_id ?? ORIGINAL_WORKSPACE,
          },
          (response) =>
            ack({ response_type: "ephemeral", text: response.text }),
        );
      });

      const forgetWorkspace = async (teamId: string | undefined) => {
        if (!teamId) return;
        workspaces.delete(teamId);
        await deps.onCredentialRejected(teamId);
      };
      bolt.event("app_uninstalled", async ({ context }) => {
        await forgetWorkspace(context.teamId);
      });
      bolt.event("tokens_revoked", async ({ event, context }) => {
        const revoked = (event as { tokens?: { bot?: string[] } }).tokens;
        if (!revoked?.bot?.length) return;
        await forgetWorkspace(context.teamId);
      });

      bolt.error(async (error) => {
        process.stderr.write(`[slack] Bolt error: ${error}\n`);
      });

      app = bolt;
      try {
        await learnOriginalWorkspace(bolt);
        await bolt.start();
      } catch (err) {
        app = null;
        process.stderr.write(
          `[slack] Failed to start Slack bot: ${formatError(err)}\n`,
        );
        return false;
      }

      return true;
    },

    async stop() {
      if (app) {
        await app.stop();
        app = null;
        workspaces.clear();
      }
    },

    async postMessage(args) {
      if (!app) return;
      const token = await tokenFor(args.teamId);
      if (!token) return;
      await app.client.chat.postMessage({
        token,
        channel: args.channel,
        text: args.text,
        thread_ts: args.threadTs,
        blocks: args.blocks,
        ...(args.replyBroadcast ? { reply_broadcast: true } : {}),
      } as ChatPostMessageArgs);
    },

    async postEphemeral(args) {
      if (!app) return;
      const token = await tokenFor(args.teamId);
      if (!token) return;
      await app.client.chat.postEphemeral({
        token,
        channel: args.channel,
        user: args.user,
        thread_ts: args.threadTs,
        text: args.text,
      });
    },

    async startStream(args): Promise<{ ts: string }> {
      if (!app) throw new Error("slack app not started");
      const token = await tokenFor(args.teamId);
      if (!token) throw new Error(INSTALL_TOKEN_MISSING);
      const res = await app.client.chat.startStream({
        token,
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
      const token = await tokenFor(args.teamId);
      if (!token) throw new Error(INSTALL_TOKEN_MISSING);
      await app.client.chat.appendStream({
        token,
        channel: args.channel,
        ts: args.ts,
        markdown_text: args.markdownText,
      });
    },

    async stopStream(args) {
      if (!app) throw new Error("slack app not started");
      const token = await tokenFor(args.teamId);
      if (!token) throw new Error(INSTALL_TOKEN_MISSING);
      await app.client.chat.stopStream({
        token,
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
      const token = await tokenFor(args.teamId);
      if (!token) throw new Error(INSTALL_TOKEN_MISSING);
      await app.client.assistant.threads.setStatus({
        token,
        channel_id: args.channel,
        thread_ts: args.threadTs,
        status: args.status,
      });
    },

    async addReaction(args) {
      if (!app) return;
      const token = await tokenFor(args.teamId);
      if (!token) return;
      await app.client.reactions.add({
        token,
        channel: args.channel,
        timestamp: args.ts,
        name: args.name,
      });
    },

    async getThreadReplies(args) {
      if (!app) return { messages: [], hasMore: false };
      const token = await tokenFor(args.teamId);
      if (!token) return { messages: [], hasMore: false };
      const replies = await app.client.conversations.replies({
        token,
        channel: args.channel,
        ts: args.threadTs,
        limit: args.limit,
        ...(args.oldest ? { oldest: args.oldest } : {}),
      });
      return {
        messages: (replies.messages ?? []).map(toSlackMessage),
        hasMore: Boolean(
          replies.has_more || replies.response_metadata?.next_cursor,
        ),
      };
    },

    async getThreadTail(args) {
      if (!app) return { messages: [], hasMore: false };
      const token = await tokenFor(args.teamId);
      if (!token) return { messages: [], hasMore: false };
      const maxPages = args.maxPages ?? THREAD_TAIL_MAX_PAGES;
      let cursor: string | undefined;
      let fold = emptyTailFold<SlackMessage>();
      let stoppedShort = false;
      for (let page = 0; ; page += 1) {
        if (page >= maxPages) {
          stoppedShort = true;
          break;
        }
        const replies = await app.client.conversations.replies({
          token,
          channel: args.channel,
          ts: args.threadTs,
          limit: args.limit,
          ...(cursor ? { cursor } : {}),
        });
        fold = foldTailPage(
          fold,
          (replies.messages ?? []).map(toSlackMessage),
          args.limit,
        );
        cursor = replies.response_metadata?.next_cursor || undefined;
        if (!cursor) break;
      }
      return { messages: fold.window, hasMore: stoppedShort };
    },

    async getChannelHistory(args) {
      if (!app) return { messages: [], hasMore: false };
      const token = await tokenFor(args.teamId);
      if (!token) return { messages: [], hasMore: false };
      const pageSize = Math.min(args.limit, CHANNEL_HISTORY_PAGE_SIZE);
      const newestFirst: SlackMessage[] = [];
      let cursor: string | undefined;
      for (;;) {
        const history = await app.client.conversations.history({
          token,
          channel: args.channel,
          limit: pageSize,
          ...(args.oldest ? { oldest: args.oldest } : {}),
          ...(cursor ? { cursor } : {}),
        });
        newestFirst.push(...(history.messages ?? []).map(toSlackMessage));
        cursor = history.response_metadata?.next_cursor || undefined;
        const olderRemain = Boolean(history.has_more || cursor);
        if (newestFirst.length >= args.limit) {
          return {
            messages: newestFirst.slice(0, args.limit),
            hasMore: olderRemain || newestFirst.length > args.limit,
          };
        }
        if (!cursor) return { messages: newestFirst, hasMore: false };
      }
    },

    async uploadFile(args) {
      if (!app) return;
      const token = await tokenFor(args.teamId);
      if (!token) return;
      const upload = {
        token,
        channel_id: args.channelId,
        file: args.file,
        filename: args.filename,
        title: args.title,
        initial_comment: args.initialComment,
      };
      await app.client.files.uploadV2(
        args.threadTs ? { ...upload, thread_ts: args.threadTs } : upload,
      );
    },

    async downloadFile(
      urlPrivate: string,
      maxBytes: number,
      teamId: SlackWorkspace,
    ): Promise<ArrayBuffer> {
      const token = await tokenFor(teamId);
      if (!token) throw new Error(INSTALL_TOKEN_MISSING);
      const res = await fetch(urlPrivate, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        throw new Error(`HTTP ${res.status}`);
      }
      const declared = Number(res.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > maxBytes) {
        await res.body?.cancel().catch(() => {});
        throw new FileTooLargeError(maxBytes);
      }
      const body = res.body;
      if (!body) return new ArrayBuffer(0);
      const chunks: Uint8Array[] = [];
      let total = 0;
      const reader = body.getReader();
      let overBudget = false;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > maxBytes) {
            overBudget = true;
            throw new FileTooLargeError(maxBytes);
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
        if (overBudget) await body.cancel().catch(() => {});
      }
      const out = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return out.buffer;
    },

    async listBotChannels(teamId: SlackWorkspace): Promise<SlackChannelInfo[]> {
      if (!app) return [];
      const token = await tokenFor(teamId);
      if (!token) return [];
      const channels: SlackChannelInfo[] = [];
      let cursor: string | undefined;
      do {
        const page = await app.client.users.conversations({
          token,
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

    async getConversationInfo(channelId: string, teamId: SlackWorkspace) {
      if (!app) return null;
      const token = await tokenFor(teamId);
      if (!token) return null;
      try {
        const info = await app.client.conversations.info({
          token,
          channel: channelId,
        });
        if (!info.channel) return null;
        return { isMember: !!info.channel.is_member };
      } catch (err) {
        if (formatError(err).includes("channel_not_found")) return null;
        throw err;
      }
    },

    async getUserInfo(
      userId: string,
      teamId: SlackWorkspace,
    ): Promise<SlackUserInfo | null> {
      if (!app) return null;
      const token = await tokenFor(teamId);
      if (!token) return null;
      let info;
      try {
        info = await app.client.users.info({ token, user: userId });
      } catch (err) {
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
      teamId: SlackWorkspace,
    ): Promise<SlackMessageReaction[] | null> {
      if (!app) return null;
      const token = await tokenFor(teamId);
      if (!token) return null;
      let result;
      try {
        result = await app.client.reactions.get({
          token,
          channel,
          timestamp: ts,
          full: true,
        });
      } catch (err) {
        if (formatError(err).includes("message_not_found")) return null;
        throw err;
      }
      return (result.message?.reactions ?? []).map((r) => ({
        name: r.name ?? "",
        count: r.count ?? 0,
        users: r.users ?? [],
      }));
    },

    async getPermalink(
      channel: string,
      ts: string,
      teamId: SlackWorkspace,
    ): Promise<string | null> {
      if (!app) return null;
      const token = await tokenFor(teamId);
      if (!token) return null;
      try {
        const result = await app.client.chat.getPermalink({
          token,
          channel,
          message_ts: ts,
        });
        return result.permalink ?? null;
      } catch {
        return null;
      }
    },

    async openDirectMessage(
      userId: string,
      teamId: SlackWorkspace,
    ): Promise<string> {
      if (!app) throw new Error("slack bot not running");
      const token = await tokenFor(teamId);
      if (!token) throw new Error(INSTALL_TOKEN_MISSING);
      const opened = await app.client.conversations.open({
        token,
        users: userId,
      });
      const id = opened.channel?.id;
      if (!id) throw new Error("Slack returned no conversation id");
      return id;
    },

    async getGrantedScopes(
      teamId: SlackWorkspace,
    ): Promise<Set<string> | null> {
      if (!app) return null;
      return (await testedAuthFor(teamId))?.scopes ?? null;
    },

    async getBotUserId(teamId: SlackWorkspace): Promise<string | null> {
      if (!app) return null;
      return (await testedAuthFor(teamId))?.botUserId ?? null;
    },
  };
}
