import { Chat, type Thread, type StateAdapter } from "chat";
import {
  createTelegramAdapter,
  type TelegramAdapter,
} from "@chat-adapter/telegram";
import {
  ChannelType,
  SessionType,
  type InstancesService,
} from "api-server-api";
import type {
  StoredChannelConfig,
  StoredTelegramChannel,
} from "../stored-channel.js";
import type { PostMessageOptions } from "../services/channel-manager.js";
import { createAcpClient } from "../../../core/acp-client.js";
import {
  buildAuthorizeUrl,
  generatePkce,
  type KeycloakOAuthConfig,
} from "./identity-oauth.js";

export interface TelegramOAuthPending {
  instanceName: string;
  telegramUserId: string;
  threadId: string;
  codeVerifier: string;
  createdAt: number;
}

export interface TelegramThreadsRepo {
  isAuthorized: (instanceId: string, threadId: string) => Promise<boolean>;
  authorize: (
    instanceId: string,
    threadId: string,
    authorizedBy: string,
  ) => Promise<void>;
  list: (instanceId: string) => Promise<string[]>;
  revoke: (instanceId: string, threadId: string) => Promise<void>;
}

export interface ChannelConversation {
  id: string;
  title: string;
}

export interface TelegramWorker {
  type: ChannelType.Telegram;
  start(instanceName: string, channel: StoredChannelConfig): Promise<void>;
  stop(instanceName: string): Promise<void>;
  stopAll(): Promise<void>;
  listConversations(instanceName: string): Promise<ChannelConversation[]>;
  postMessage(
    instanceName: string,
    text: string,
    options?: PostMessageOptions,
  ): Promise<{ ok: true } | { error: string }>;
}

interface InstanceBot {
  chat: Chat;
  adapter: TelegramAdapter;
  botToken: string;
}

async function isTelegramChatAdmin(
  botToken: string,
  chatId: string,
  userId: string,
): Promise<boolean> {
  const url = `https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${encodeURIComponent(chatId)}&user_id=${encodeURIComponent(userId)}`;
  const res = await fetch(url);
  if (!res.ok) return false;
  const data = (await res.json()) as {
    ok: boolean;
    result?: { status: string };
  };
  if (!data.ok || !data.result) return false;
  return (
    data.result.status === "creator" || data.result.status === "administrator"
  );
}

async function fetchTelegramChatTitle(
  botToken: string,
  chatId: string,
): Promise<string> {
  const url = `https://api.telegram.org/bot${botToken}/getChat?chat_id=${encodeURIComponent(chatId)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return chatId;
    const data = (await res.json()) as {
      ok: boolean;
      result?: {
        title?: string;
        first_name?: string;
        last_name?: string;
        username?: string;
      };
    };
    const r = data.result;
    if (!data.ok || !r) return chatId;
    if (r.title) return r.title;
    const name = [r.first_name, r.last_name].filter(Boolean).join(" ").trim();
    if (name) return name;
    if (r.username) return `@${r.username}`;
    return chatId;
  } catch {
    return chatId;
  }
}

export function createTelegramWorker(
  namespace: string,
  state: StateAdapter,
  instances: () => InstancesService,
  persistSession: (
    sessionId: string,
    instanceId: string,
    type: SessionType,
    threadId?: string,
  ) => Promise<void>,
  threads: TelegramThreadsRepo,
  oauthConfig: KeycloakOAuthConfig,
  pendingOAuthFlows: Map<string, TelegramOAuthPending>,
  threadSessions: {
    find: (
      instanceId: string,
      threadId: string,
    ) => Promise<{ sessionId: string } | null>;
    touch: (sessionId: string) => Promise<void>;
  },
): TelegramWorker {
  const bots = new Map<string, InstanceBot>();
  const lastThread = new Map<string, Thread>();

  async function relayToInstance(
    instanceName: string,
    thread: Thread,
    text: string,
    author: { userId: string; fullName: string; userName: string },
  ) {
    lastThread.set(instanceName, thread);

    const context = thread.isDM
      ? `This is a 1:1 direct message from ${author.fullName} (@${author.userName}, id=${author.userId}). Every message here is directed at you — always reply.`
      : `This is a group conversation. The message is from ${author.fullName} (@${author.userName}, id=${author.userId}). Other participants may follow up; only respond when it makes sense — stay quiet when the conversation isn't for you.`;

    const freshPrompt = [
      `You are participating in a Telegram conversation (chatId="${thread.id}").`,
      context,
      `To reply, call \`send_channel_message\` with channel="telegram" and chatId="${thread.id}".`,
      "",
      `Message: ${text}`,
    ].join("\n");

    try {
      await instances().ensureReady(instanceName);
      const acp = createAcpClient({ namespace, instanceName });

      const existing = await threadSessions.find(instanceName, thread.id);
      if (existing) {
        try {
          await acp.sendPrompt(text, { resumeSessionId: existing.sessionId });
          await threadSessions.touch(existing.sessionId);
          return;
        } catch (err) {
          process.stderr.write(
            `[telegram:${instanceName}] resume failed, starting fresh: ${err}\n`,
          );
        }
      }
      await acp.sendPrompt(freshPrompt, {
        onSessionCreated: (sid) =>
          persistSession(
            sid,
            instanceName,
            SessionType.ChannelTelegram,
            thread.id,
          ),
      });
    } catch (err) {
      process.stderr.write(`[telegram:${instanceName}] ACP error: ${err}\n`);
    }
  }

  async function buildBot(
    instanceName: string,
    botToken: string,
  ): Promise<InstanceBot> {
    const adapter = createTelegramAdapter({ botToken, mode: "polling" });

    const chat = new Chat({
      userName: "platform",
      adapters: { telegram: adapter },
      state,
    });

    async function handleLogin(thread: Thread, telegramUserId: string) {
      if (!thread.isDM) {
        const { chatId } = adapter.decodeThreadId(thread.id);
        const isAdmin = await isTelegramChatAdmin(
          botToken,
          chatId,
          telegramUserId,
        );
        if (!isAdmin) {
          await thread.post("Only group admins can /login.");
          return;
        }
      }

      const alreadyAuthorized = await threads.isAuthorized(
        instanceName,
        thread.id,
      );
      if (alreadyAuthorized) {
        await thread.post(
          "This conversation is already authorized. Send /logout to revoke.",
        );
        return;
      }

      const { state: oauthState, codeVerifier, codeChallenge } = generatePkce();
      pendingOAuthFlows.set(oauthState, {
        instanceName,
        telegramUserId,
        threadId: thread.id,
        codeVerifier,
        createdAt: Date.now(),
      });
      const url = buildAuthorizeUrl(oauthConfig, oauthState, codeChallenge);
      await thread.post(
        `Open this link to authorize this conversation (instance owner only):\n${url}`,
      );
    }

    async function handleLogout(thread: Thread, telegramUserId: string) {
      if (!thread.isDM) {
        const { chatId } = adapter.decodeThreadId(thread.id);
        const isAdmin = await isTelegramChatAdmin(
          botToken,
          chatId,
          telegramUserId,
        );
        if (!isAdmin) {
          await thread.post("Only group admins can /logout.");
          return;
        }
      }

      const authorized = await threads.isAuthorized(instanceName, thread.id);
      if (!authorized) {
        await thread.post("This conversation isn't authorized.");
        return;
      }
      await threads.revoke(instanceName, thread.id);
      await thread.post(
        "Conversation revoked. Send /login to authorize again.",
      );
    }

    async function handleMessage(
      thread: Thread,
      message: {
        text: string;
        author: {
          userId: string;
          userName: string;
          fullName: string;
          isMe: boolean;
        };
      },
      subscribe: boolean,
    ) {
      if (message.author.isMe) return;
      const text = message.text.trim();

      if (
        text === "/login" ||
        text.startsWith("/login ") ||
        text.startsWith("/login@")
      ) {
        await handleLogin(thread, message.author.userId);
        return;
      }
      if (
        text === "/logout" ||
        text.startsWith("/logout ") ||
        text.startsWith("/logout@")
      ) {
        await handleLogout(thread, message.author.userId);
        return;
      }

      const authorized = await threads.isAuthorized(instanceName, thread.id);
      if (!authorized) {
        // Only prompt for /login in DMs. Staying silent in groups avoids
        // spamming unauthorized group chats that the bot happens to be in.
        if (thread.isDM) {
          await thread.post(
            "This conversation isn't authorized. An admin needs to send /login.",
          );
        }
        return;
      }
      if (subscribe) await thread.subscribe();
      await relayToInstance(instanceName, thread, message.text, message.author);
    }

    // DMs: subscribe so the bot receives every follow-up from this user.
    chat.onDirectMessage((thread, message) =>
      handleMessage(thread, message, true),
    );
    // Groups: on first @-mention, subscribe so the agent can see the full
    // conversation as context. The agent — not the worker — decides whether
    // to actually respond (via the send_channel_message MCP tool).
    chat.onNewMention((thread, message) =>
      handleMessage(thread, message, true),
    );
    // Follow-ups in any subscribed thread (DM or group).
    chat.onSubscribedMessage((thread, message) =>
      handleMessage(thread, message, false),
    );

    await chat.initialize();
    await adapter.startPolling();
    return { chat, adapter, botToken };
  }

  async function stopInternal(instanceName: string) {
    const bot = bots.get(instanceName);
    if (!bot) return;
    bots.delete(instanceName);
    lastThread.delete(instanceName);
    // Only stop polling. Deliberately avoid `chat.shutdown()` — it disconnects
    // the shared state adapter, which would break every other running bot.
    try {
      await bot.adapter.stopPolling();
    } catch {}
    process.stderr.write(`[telegram] stopped bot for ${instanceName}\n`);
  }

  return {
    type: ChannelType.Telegram,

    async start(instanceName: string, channel: StoredChannelConfig) {
      // Defensive: if a bot is already running for this instance (e.g. after
      // a token change where disconnect+connect events raced), tear it down
      // before starting the new one.
      await stopInternal(instanceName);
      const { botToken } = channel as StoredTelegramChannel;
      try {
        const bot = await buildBot(instanceName, botToken);
        bots.set(instanceName, bot);
        process.stderr.write(`[telegram] started bot for ${instanceName}\n`);
      } catch (err) {
        process.stderr.write(
          `[telegram] failed to start ${instanceName}: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    },

    async stop(instanceName: string) {
      await stopInternal(instanceName);
    },

    async stopAll() {
      const names = [...bots.keys()];
      await Promise.all(names.map(stopInternal));
      // Disconnect the shared state adapter exactly once, at process shutdown.
      try {
        await (
          state as unknown as { disconnect?: () => Promise<void> }
        ).disconnect?.();
      } catch {}
    },

    async listConversations(instanceName: string) {
      const bot = bots.get(instanceName);
      if (!bot) return [];
      const threadIds = await threads.list(instanceName);
      return Promise.all(
        threadIds.map(async (threadId) => {
          const { chatId } = bot.adapter.decodeThreadId(threadId);
          const title = await fetchTelegramChatTitle(bot.botToken, chatId);
          return { id: threadId, title };
        }),
      );
    },

    async postMessage(
      instanceName: string,
      text: string,
      options?: PostMessageOptions,
    ) {
      const bot = bots.get(instanceName);
      if (!bot) return { error: "telegram bot not running for this instance" };

      const { conversationId, attachment } = options ?? {};
      const payload = attachment
        ? {
            markdown: text,
            files: [
              {
                data: attachment.data,
                filename: attachment.filename,
                ...(attachment.mimeType
                  ? { mimeType: attachment.mimeType }
                  : {}),
              },
            ],
          }
        : text;

      if (conversationId) {
        const authorized = await threads.isAuthorized(
          instanceName,
          conversationId,
        );
        if (!authorized) return { error: "conversation is not authorized" };
        try {
          await bot.adapter.postMessage(conversationId, payload);
          return { ok: true as const };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      }

      const thread = lastThread.get(instanceName);
      if (!thread)
        return {
          error:
            "no active Telegram thread; pass conversationId from list_channel_conversations",
        };
      try {
        await thread.post(payload);
        return { ok: true as const };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
