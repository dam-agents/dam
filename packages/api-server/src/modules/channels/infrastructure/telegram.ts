import type { TtlStore } from "../../../core/ttl-store.js";
import type { ChannelTurnAttendance } from "../../../core/turn-attendance.js";
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
import { channelNetworkAccessGuidance } from "./network-access-copy.js";
import {
  createConversationQueue,
  type ConversationQueue,
} from "./conversation-queue.js";
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

type TelegramPendingMessage = {
  text: string;
  author: TelegramInboundMessage["author"];
  thread: ThreadLike;
};

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

export interface TelegramWorker {
  type: ChannelType.Telegram;
  start(): Promise<void>;
  stopAll(): Promise<void>;
  resolveIdentity(): Promise<void>;
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

export function createTelegramMessageHandler(deps: {
  conversations: TelegramConversationsPort;
  isChatAdmin: (chatId: string, userId: string) => Promise<boolean>;
  decodeChatId: (threadId: string) => string;
  fetchChatTitle: (chatId: string) => Promise<string>;
  oauthConfig: KeycloakOAuthConfig;
  pendingOAuthFlows: TtlStore<TelegramOAuthPending>;
  isTermsAccepted: (sub: string) => Promise<boolean>;
  uiBaseUrl: string;
  brandShort: string;
  relay: (
    agentId: string,
    thread: ThreadLike,
    text: string,
    author: TelegramInboundMessage["author"],
  ) => Promise<void>;
}) {
  const brandCmd = `/${deps.brandShort}`;

  async function denyNonAdmin(
    thread: ThreadLike,
    telegramUserId: string,
    action: "bind" | "unbind",
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
      detail: { telegramUserId, threadId: thread.id, command: action },
    });
    await thread.post(`Only group admins can \`${brandCmd} ${action}\`.`);
    return true;
  }

  async function handleBind(thread: ThreadLike, telegramUserId: string) {
    if (await denyNonAdmin(thread, telegramUserId, "bind")) return;

    const binding = await deps.conversations.findAgentByConversation(thread.id);
    if (binding) {
      await thread.post(
        `This chat is already connected to an agent. Send \`${brandCmd} unbind\` first to reconnect.`,
      );
      return;
    }

    const chatTitle = await deps.fetchChatTitle(deps.decodeChatId(thread.id));
    const { state: oauthState, codeVerifier, codeChallenge } = generatePkce();
    await deps.pendingOAuthFlows.set(oauthState, {
      telegramUserId,
      threadId: thread.id,
      codeVerifier,
      chatTitle,
      createdAt: Date.now(),
    });
    const url = buildAuthorizeUrl(deps.oauthConfig, oauthState, codeChallenge);
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

  async function handleUnbind(thread: ThreadLike, telegramUserId: string) {
    if (await denyNonAdmin(thread, telegramUserId, "unbind")) return;

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
    await thread.post(
      `Chat disconnected. Send \`${brandCmd} bind\` to connect it again.`,
    );
  }

  return async function handleMessage(
    thread: ThreadLike,
    message: TelegramInboundMessage,
    subscribe: boolean,
  ) {
    if (message.author.isMe) return;
    const text = message.text.trim();

    if (isCommand(text, brandCmd)) {
      const sub =
        text
          .slice(brandCmd.length)
          .replace(/^@\S+/, "")
          .trim()
          .toLowerCase()
          .split(/\s+/)[0] ?? "";
      if (sub === "bind") {
        await handleBind(thread, message.author.userId);
      } else if (sub === "unbind") {
        await handleUnbind(thread, message.author.userId);
      } else {
        await thread.post(
          `Send \`${brandCmd} bind\` to connect an agent, or \`${brandCmd} unbind\` to disconnect.`,
        );
      }
      return;
    }

    if (isCommand(text, "/start")) {
      await handleBind(thread, message.author.userId);
      return;
    }

    const binding = await deps.conversations.findAgentByConversation(thread.id);
    if (!binding) {
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
      if (thread.isDM) {
        await thread.post(
          `This chat isn't connected to an agent. An admin needs to send \`${brandCmd} bind\`.`,
        );
      }
      return;
    }

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
  configuredBotUsername?: string | null;
  makeAcpClient: AcpClientFactory;
  state: StateAdapter;
  agents: () => AgentsService;
  conversations: TelegramConversationsPort;
  oauthConfig: KeycloakOAuthConfig;
  pendingOAuthFlows: TtlStore<TelegramOAuthPending>;
  isTermsAccepted: (sub: string) => Promise<boolean>;
  uiBaseUrl: string;
  brandShort: string;
  brandName: string;
  emit?: (event: DomainEvent) => void;
  attendance: ChannelTurnAttendance;
  isChatAdmin?: (chatId: string, userId: string) => Promise<boolean>;
  settleMs?: number;
}): TelegramWorker {
  const emit = deps.emit ?? defaultEmit;
  const { botToken, makeAcpClient, agents, attendance, brandName } = deps;

  let bot: {
    chat: Chat;
    adapter: ReturnType<typeof createTelegramAdapter>;
  } | null = null;
  let username: string | null = deps.configuredBotUsername ?? null;
  const lastThread = new Map<string, Thread>();

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
    messages: TelegramPendingMessage[],
    onSession?: (sessionId: string) => void,
  ) {
    lastThread.set(agentId, thread as Thread);

    const author = messages.at(-1)!.author;
    const batched = messages.length > 1;
    const text = batched
      ? messages.map((m) => `[@${m.author.userName}] ${m.text}`).join("\n")
      : messages[0]!.text;

    const who = batched
      ? `${messages.length} messages arrived together; each line is tagged with who sent it. Answer them as one — reply once, covering all of them.`
      : "";
    const context = (
      thread.isDM
        ? `This is a 1:1 direct message from ${author.fullName} (@${author.userName}, id=${author.userId}). Every message here is directed at you — always reply.`
        : `This is a group conversation. The message is from ${author.fullName} (@${author.userName}, id=${author.userId}). Other participants may follow up; only respond when it makes sense — stay quiet when the conversation isn't for you.`
    ).concat(who ? ` ${who}` : "");

    const freshPrompt = [
      `You are participating in a Telegram conversation (chatId="${thread.id}").`,
      context,
      `To reply, call the \`mcp__platform-outbound__send_channel_message\` tool with channel="telegram" and chatId="${thread.id}". If the tool is deferred, load it via ToolSearch first.`,
      "IMPORTANT: Your text output is NOT delivered to Telegram — only tool calls reach the user.",
      "To deliberately stay silent — a group message that isn't for you, or one already handled — call `mcp__platform-outbound__no_reply_needed` instead of replying.",
      "These instructions apply to messages that arrive from Telegram, not to this conversation as a whole. A message that arrives without them came from somewhere else: answer it where it arrived, in plain text, and post to Telegram for it only if you're asked to.",
      channelNetworkAccessGuidance(brandName),
      "",
      `Message: ${text}`,
    ].join("\n");

    let outcome: TurnOutcome = "failure";
    let failureReason: string | undefined;
    const releaseAttendance = attendance.openChannelTurn(agentId);
    try {
      await agents().ensureReady(agentId);
      const acp = makeAcpClient(agentId);

      const existing = await findThreadSession(agentId, thread.id);
      if (existing) {
        try {
          onSession?.(existing.sessionId);
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
        ...(onSession ? { onSession } : {}),
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
      if (isAgentWakeTimeoutError(err)) {
        await thread.post(wakeFailureUserCopy(err.failure)).catch(() => {});
      }
    } finally {
      releaseAttendance();
      emitTurn(agentId, outcome, author.userId, failureReason);
    }
  }

  const telegramQueues = new Map<
    string,
    ConversationQueue<TelegramPendingMessage>
  >();

  function steerFrame(batch: TelegramPendingMessage[]): string {
    const one = batch.length === 1;
    return [
      "<new-messages>",
      `${one ? "Another message" : `${batch.length} more messages`} arrived in this chat while you were working. Read ${one ? "it" : "them"} before you reply, and answer everything in one reply rather than replying more than once.`,
      ...batch.map((m) => `[@${m.author.userName}] ${m.text}`),
      "</new-messages>",
    ].join("\n");
  }

  function createChatQueue(
    key: string,
    agentId: string,
    threadId: string,
  ): ConversationQueue<TelegramPendingMessage> {
    return createConversationQueue<TelegramPendingMessage>({
      settleMs: deps.settleMs ?? 0,
      runTurn: (batch, onSession) =>
        relayToInstance(agentId, batch.at(-1)!.thread, batch, onSession),
      steer: async (sessionId, batch) => {
        const outcome = await makeAcpClient(agentId).steer(
          sessionId,
          steerFrame(batch),
        );
        if (outcome === "injected") return "injected";
        getLogger().debug(
          { agentId, threadId, outcome },
          "telegram.turn.steer_declined",
        );
        return outcome === "unsupported" ? "unsupported" : "refused";
      },
      onEmpty: () => {
        telegramQueues.delete(key);
      },
      onError: (err) => {
        getLogger().warn(
          { agentId, threadId, error: String(err) },
          "telegram.chat_drain.failed",
        );
      },
    });
  }

  function enqueueTelegramTurn(
    agentId: string,
    thread: ThreadLike,
    text: string,
    author: TelegramInboundMessage["author"],
  ): Promise<void> {
    const key = `${agentId}|${thread.id}`;
    let queue = telegramQueues.get(key);
    if (!queue) {
      queue = createChatQueue(key, agentId, thread.id);
      telegramQueues.set(key, queue);
    }
    return queue.submit({ text, author, thread });
  }

  function emitTurn(
    agentId: string,
    outcome: TurnOutcome,
    telegramUserId: string,
    reason?: string,
  ) {
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

    async resolveIdentity() {
      if (username) return;
      username = await fetchTelegramBotUsername(botToken).catch(() => null);
    },

    async start() {
      if (bot) return;
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
          brandShort: deps.brandShort,
          relay: enqueueTelegramTurn,
        });

        chat.onDirectMessage((thread, message) =>
          handleMessage(thread, message, true),
        );
        chat.onNewMention((thread, message) =>
          handleMessage(thread, message, true),
        );
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
        process.stderr.write(
          `[telegram] failed to start platform bot: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        throw err;
      }
    },

    async stopAll() {
      if (bot) {
        try {
          await bot.adapter.stopPolling();
        } catch {}
        bot = null;
      }
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
