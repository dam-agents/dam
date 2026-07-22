import {
  Actions,
  Card,
  CardText,
  Chat,
  LinkButton,
  type CardElement,
  type Thread,
  type StateAdapter,
} from "chat";
import { createTelegramAdapter } from "@chat-adapter/telegram";
import { ChannelType, SessionType, type AgentsService } from "api-server-api";
import type { PostMessageOptions } from "../services/channel-manager.js";
import { type AcpClientFactory } from "../../../core/acp-client.js";
import { getLogger } from "../../../core/logger.js";
import { securityLog } from "../../../core/security-log.js";
import {
  isAgentWakeTimeoutError,
  wakeFailureReasonToken,
} from "../../agents/index.js";
import { wakeFailureUserCopy } from "./wake-failure-copy.js";
import {
  buildAuthorizeUrl,
  generatePkce,
  type KeycloakOAuthConfig,
} from "./identity-oauth.js";
import type { TelegramOAuthPending } from "./telegram-flows.js";
import {
  EventType,
  emit as defaultEmit,
  type DomainEvent,
  type TurnOutcome,
} from "../../../events.js";

/** The chat→Agent binding surface the worker reads on every message. The
 *  telegram-conversations repository satisfies this structurally. */
export interface TelegramConversationsPort {
  findAgentByConversation(
    conversationId: string,
  ): Promise<{ agentId: string; authorizedBy: string } | null>;
  bind(
    conversationId: string,
    agentId: string,
    authorizedBy: string,
  ): Promise<"bound" | "conflict">;
  listByAgent(agentId: string): Promise<string[]>;
  unbind(conversationId: string): Promise<void>;
}

export interface ChannelConversation {
  id: string;
  title: string;
}

/** One platform-wide bot: `start()` runs once at boot (the bot must poll
 *  even with zero bindings so `/login` works in brand-new chats); per-agent
 *  lifecycle does not exist. */
export interface TelegramWorker {
  type: ChannelType.Telegram;
  start(): Promise<void>;
  stopAll(): Promise<void>;
  /** Handle of the bot (no @), from getMe at start; null until started. */
  botUsername(): string | null;
  listConversations(agentId: string): Promise<ChannelConversation[]>;
  postMessage(
    agentId: string,
    text: string,
    options?: PostMessageOptions,
  ): Promise<{ ok: true } | { error: string }>;
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

async function fetchTelegramBotUsername(
  botToken: string,
): Promise<string | null> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      ok: boolean;
      result?: { username?: string };
    };
    return data.ok ? (data.result?.username ?? null) : null;
  } catch {
    return null;
  }
}

/** The slice of a chat-sdk Thread the message handler needs — narrow so
 *  routing is unit-testable without an adapter. */
export interface ThreadLike {
  id: string;
  isDM: boolean;
  post(message: string | CardElement): Promise<unknown>;
  subscribe(): Promise<unknown>;
}

export interface TelegramInboundMessage {
  text: string;
  author: {
    userId: string;
    userName: string;
    fullName: string;
    isMe: boolean;
  };
}

function isCommand(text: string, command: string): boolean {
  return (
    text === command ||
    text.startsWith(`${command} `) ||
    text.startsWith(`${command}@`)
  );
}

/** Inbound routing for the platform bot, extracted from the worker for
 *  testability: command handling, the binding gate, and the relay hand-off. */
export function createTelegramMessageHandler(deps: {
  conversations: TelegramConversationsPort;
  isChatAdmin: (chatId: string, userId: string) => Promise<boolean>;
  decodeChatId: (threadId: string) => string;
  fetchChatTitle: (chatId: string) => Promise<string>;
  oauthConfig: KeycloakOAuthConfig;
  pendingOAuthFlows: Map<string, TelegramOAuthPending>;
  isTermsAccepted: (sub: string) => Promise<boolean>;
  uiBaseUrl: string;
  relay: (
    agentId: string,
    thread: ThreadLike,
    text: string,
    author: TelegramInboundMessage["author"],
  ) => Promise<void>;
}) {
  async function denyNonAdmin(
    thread: ThreadLike,
    telegramUserId: string,
    command: "login" | "logout",
  ): Promise<boolean> {
    if (thread.isDM) return false;
    const isAdmin = await deps.isChatAdmin(
      deps.decodeChatId(thread.id),
      telegramUserId,
    );
    if (isAdmin) return false;
    securityLog("warn", "channel.authz_deny", {
      category: "channel",
      actor: null,
      actorKind: "external",
      surface: "telegram",
      decision: "deny",
      reason: "not-group-admin",
      detail: { telegramUserId, threadId: thread.id, command },
    });
    await thread.post(`Only group admins can /${command}.`);
    return true;
  }

  async function handleLogin(thread: ThreadLike, telegramUserId: string) {
    if (await denyNonAdmin(thread, telegramUserId, "login")) return;

    const binding = await deps.conversations.findAgentByConversation(thread.id);
    if (binding) {
      await thread.post(
        "This chat is already connected to an agent. Send /logout first to reconnect.",
      );
      return;
    }

    const chatTitle = await deps.fetchChatTitle(deps.decodeChatId(thread.id));
    const { state: oauthState, codeVerifier, codeChallenge } = generatePkce();
    deps.pendingOAuthFlows.set(oauthState, {
      telegramUserId,
      threadId: thread.id,
      codeVerifier,
      chatTitle,
      createdAt: Date.now(),
    });
    const url = buildAuthorizeUrl(deps.oauthConfig, oauthState, codeChallenge);
    // A card renders as text + an inline-keyboard URL button, hiding the raw
    // OAuth URL. Fall back to the bare link if Telegram rejects the button
    // (e.g. a URL it can't validate) — the login must still be reachable.
    try {
      await thread.post(
        Card({
          children: [
            CardText("Connect this chat to one of your agents:"),
            Actions([LinkButton({ label: "Connect an agent", url })]),
          ],
        }),
      );
    } catch {
      await thread.post(
        `Open this link to connect this chat to one of your agents:\n${url}`,
      );
    }
  }

  async function handleLogout(thread: ThreadLike, telegramUserId: string) {
    if (await denyNonAdmin(thread, telegramUserId, "logout")) return;

    const binding = await deps.conversations.findAgentByConversation(thread.id);
    if (!binding) {
      await thread.post("This chat isn't connected to an agent.");
      return;
    }
    await deps.conversations.unbind(thread.id);
    securityLog("info", "channel.chat_unbound", {
      category: "authz-list",
      actor: null,
      actorKind: "external",
      surface: "telegram",
      agentId: binding.agentId,
      result: "success",
      detail: { conversationId: thread.id, byTelegramUserId: telegramUserId },
    });
    await thread.post("Chat disconnected. Send /login to connect it again.");
  }

  return async function handleMessage(
    thread: ThreadLike,
    message: TelegramInboundMessage,
    subscribe: boolean,
  ) {
    if (message.author.isMe) return;
    const text = message.text.trim();

    if (isCommand(text, "/start")) {
      // /start is how deep links and the Start button deliver intent; any
      // payload reads as login intent — the group-admin gate still applies.
      await handleLogin(thread, message.author.userId);
      return;
    }

    if (isCommand(text, "/login")) {
      await handleLogin(thread, message.author.userId);
      return;
    }
    if (isCommand(text, "/logout")) {
      await handleLogout(thread, message.author.userId);
      return;
    }

    const binding = await deps.conversations.findAgentByConversation(thread.id);
    if (!binding) {
      // A chat no owner has bound attempting to drive an agent. Repeated
      // hits from the same chat are the probing signal.
      securityLog("warn", "channel.inbound.unauthorized", {
        category: "channel",
        actor: null,
        actorKind: "external",
        surface: "telegram",
        decision: "deny",
        reason: "chat-not-bound",
        detail: {
          telegramUserId: message.author.userId,
          threadId: thread.id,
          isDM: thread.isDM,
        },
      });
      // Only prompt for /login in DMs. Staying silent in groups avoids
      // spamming unbound group chats the bot happens to be in.
      if (thread.isDM) {
        await thread.post(
          "This chat isn't connected to an agent. An admin needs to send /login.",
        );
      }
      return;
    }

    // Turns run under the bound Agent's credentials, so the terms gate binds
    // the owner who lent them.
    if (!(await deps.isTermsAccepted(binding.authorizedBy))) {
      if (thread.isDM) {
        await thread.post(
          `Open ${deps.uiBaseUrl} to accept the Terms of Use before continuing.`,
        );
      }
      return;
    }
    if (subscribe) await thread.subscribe();
    await deps.relay(binding.agentId, thread, message.text, message.author);
  };
}

export function createTelegramWorker(deps: {
  botToken: string;
  /** Operator-configured bot handle (no @). Authoritative when set; the
   *  worker falls back to getMe at start when it isn't. */
  configuredBotUsername?: string | null;
  makeAcpClient: AcpClientFactory;
  state: StateAdapter;
  agents: () => AgentsService;
  conversations: TelegramConversationsPort;
  oauthConfig: KeycloakOAuthConfig;
  pendingOAuthFlows: Map<string, TelegramOAuthPending>;
  isTermsAccepted: (sub: string) => Promise<boolean>;
  uiBaseUrl: string;
  emit?: (event: DomainEvent) => void;
  /** Test seam; defaults to the Bot API getChatMember check. */
  isChatAdmin?: (chatId: string, userId: string) => Promise<boolean>;
}): TelegramWorker {
  const emit = deps.emit ?? defaultEmit;
  const { botToken, makeAcpClient, agents } = deps;

  // One bot for the install; in-memory state assumes a single replica, like
  // the OAuth pending-flow maps.
  let bot: {
    chat: Chat;
    adapter: ReturnType<typeof createTelegramAdapter>;
  } | null = null;
  let startFailed = false;
  let username: string | null = deps.configuredBotUsername ?? null;
  const lastThread = new Map<string, Thread>();

  // The conversation's session carries the thread id in
  // `_meta.platform.threadTs` — resolved off the agent, no server store.
  async function findThreadSession(agentId: string, threadId: string) {
    const acp = makeAcpClient(agentId);
    const sessions = await acp.listSessions().catch((err) => {
      process.stderr.write(
        `[telegram:${agentId}] listSessions failed: ${err}\n`,
      );
      return [];
    });
    return sessions.find((s) => s.platform?.threadTs === threadId) ?? null;
  }

  async function relayToInstance(
    agentId: string,
    thread: ThreadLike,
    text: string,
    author: { userId: string; fullName: string; userName: string },
  ) {
    lastThread.set(agentId, thread as Thread);

    const context = thread.isDM
      ? `This is a 1:1 direct message from ${author.fullName} (@${author.userName}, id=${author.userId}). Every message here is directed at you — always reply.`
      : `This is a group conversation. The message is from ${author.fullName} (@${author.userName}, id=${author.userId}). Other participants may follow up; only respond when it makes sense — stay quiet when the conversation isn't for you.`;

    const freshPrompt = [
      `You are participating in a Telegram conversation (chatId="${thread.id}").`,
      context,
      `To reply, call the \`mcp__platform-outbound__send_channel_message\` tool with channel="telegram" and chatId="${thread.id}". If the tool is deferred, load it via ToolSearch first.`,
      "IMPORTANT: Your text output is NOT delivered to Telegram — only tool calls reach the user.",
      "To deliberately stay silent — a group message that isn't for you, or one already handled — call `mcp__platform-outbound__no_reply_needed` instead of replying.",
      "",
      `Message: ${text}`,
    ].join("\n");

    let outcome: TurnOutcome = "failure";
    let failureReason: string | undefined;
    try {
      await agents().ensureReady(agentId);
      const acp = makeAcpClient(agentId);

      const existing = await findThreadSession(agentId, thread.id);
      if (existing) {
        try {
          await acp.sendPrompt(text, { resumeSessionId: existing.sessionId });
          outcome = "success";
          return;
        } catch (err) {
          process.stderr.write(
            `[telegram:${agentId}] resume failed, starting fresh: ${err}\n`,
          );
        }
      }
      await acp.sendPrompt(freshPrompt, {
        platformMeta: {
          type: SessionType.ChannelTelegram,
          threadTs: thread.id,
        },
      });
      outcome = "success";
    } catch (err) {
      failureReason = isAgentWakeTimeoutError(err)
        ? wakeFailureReasonToken(err.failure)
        : "acp-error";
      getLogger().warn(
        { agentId, reason: failureReason, error: String(err) },
        "telegram.turn.failed",
      );
      // Wake timeouts get a human reply; other errors stay log-only as
      // before (out of scope here).
      if (isAgentWakeTimeoutError(err)) {
        await thread.post(wakeFailureUserCopy(err.failure)).catch(() => {});
      }
    } finally {
      emitTurn(agentId, outcome, author.userId, failureReason);
    }
  }

  function emitTurn(
    agentId: string,
    outcome: TurnOutcome,
    telegramUserId: string,
    reason?: string,
  ) {
    // Place-scoped access: no platform identity exists on this path — the
    // Telegram user id is the actor record.
    emit({
      type: EventType.ChannelTurnRelayed,
      channel: "telegram",
      agentId,
      actorSub: null,
      externalActorId: telegramUserId,
      outcome,
      ...(reason !== undefined ? { reason } : {}),
    });
  }

  return {
    type: ChannelType.Telegram,

    botUsername() {
      return username;
    },

    async start() {
      if (bot || startFailed) return;
      try {
        const adapter = createTelegramAdapter({ botToken, mode: "polling" });
        const chat = new Chat({
          userName: "platform",
          adapters: { telegram: adapter },
          state: deps.state,
        });

        const handleMessage = createTelegramMessageHandler({
          conversations: deps.conversations,
          isChatAdmin:
            deps.isChatAdmin ??
            ((chatId, userId) => isTelegramChatAdmin(botToken, chatId, userId)),
          decodeChatId: (threadId) => adapter.decodeThreadId(threadId).chatId,
          fetchChatTitle: (chatId) => fetchTelegramChatTitle(botToken, chatId),
          oauthConfig: deps.oauthConfig,
          pendingOAuthFlows: deps.pendingOAuthFlows,
          isTermsAccepted: deps.isTermsAccepted,
          uiBaseUrl: deps.uiBaseUrl,
          relay: relayToInstance,
        });

        // DMs: subscribe so the bot receives every follow-up from this user.
        chat.onDirectMessage((thread, message) =>
          handleMessage(thread, message, true),
        );
        // Groups: on first @-mention, subscribe so the agent can see the full
        // conversation as context. The agent — not the worker — decides
        // whether to actually respond (via the send_channel_message MCP tool).
        chat.onNewMention((thread, message) =>
          handleMessage(thread, message, true),
        );
        // Follow-ups in any subscribed thread (DM or group).
        chat.onSubscribedMessage((thread, message) =>
          handleMessage(thread, message, false),
        );

        await chat.initialize();
        await adapter.startPolling();
        bot = { chat, adapter };
        if (!username) username = await fetchTelegramBotUsername(botToken);
        process.stderr.write(
          `[telegram] platform bot started${username ? ` (@${username})` : ""}\n`,
        );
      } catch (err) {
        startFailed = true;
        process.stderr.write(
          `[telegram] failed to start platform bot: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    },

    async stopAll() {
      if (bot) {
        try {
          await bot.adapter.stopPolling();
        } catch {}
        bot = null;
      }
      // Disconnect the shared state adapter exactly once, at shutdown.
      try {
        await (
          deps.state as unknown as { disconnect?: () => Promise<void> }
        ).disconnect?.();
      } catch {}
    },

    async listConversations(agentId: string) {
      if (!bot) return [];
      const adapter = bot.adapter;
      const conversationIds = await deps.conversations.listByAgent(agentId);
      return Promise.all(
        conversationIds.map(async (conversationId) => {
          const { chatId } = adapter.decodeThreadId(conversationId);
          const title = await fetchTelegramChatTitle(botToken, chatId);
          return { id: conversationId, title };
        }),
      );
    },

    async postMessage(
      agentId: string,
      text: string,
      options?: PostMessageOptions,
    ) {
      if (!bot) return { error: "telegram bot is not running" };

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

      // One shared bot serves every agent, so outbound shares one Telegram
      // rate budget (~30 msg/s install-wide); errors surface to the caller.
      if (conversationId) {
        const binding =
          await deps.conversations.findAgentByConversation(conversationId);
        if (!binding || binding.agentId !== agentId)
          return { error: "conversation is not connected to this agent" };
        try {
          await bot.adapter.postMessage(conversationId, payload);
          return { ok: true as const };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      }

      const thread = lastThread.get(agentId);
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
