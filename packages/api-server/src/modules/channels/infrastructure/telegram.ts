import type { TtlStore } from "../../../core/ttl-store.js";
import {
  annotateSpan,
  inBackgroundSpan,
} from "../../../core/background-span.js";
import type { ChannelTurnAttendance } from "../../../core/turn-attendance.js";
import {
  Actions,
  Card,
  CardText,
  Chat,
  LinkButton,
  type Adapter,
  type LogLevel,
  type CardElement,
  type Thread,
  type StateAdapter,
} from "chat";
import { ChannelType, SessionType, type AgentsService } from "api-server-api";
import { TelegramConversationAdapter } from "./telegram-conversation-adapter.js";
import type {
  ChannelWorker,
  PostMessageOptions,
} from "../services/worker-contract.js";
import {
  AcpSessionLoadError,
  AcpTurnAbandonedError,
  type AcpClientFactory,
} from "../../../core/acp-client.js";
import { classifyTurnFailure } from "./turn-failure-copy.js";
import { getLogger } from "../../../core/logger.js";
import { channelDeny } from "./channel-authz.js";
import { securityLog } from "../../../core/security-log.js";
import {
  isAgentStoppedError,
  isTelegramPrivateChat,
  telegramChatOf,
} from "../../agents/index.js";
import { OUTBOUND_TOOL_PREFIX } from "../../../core/platform-mcp.js";
import { channelNetworkAccessGuidance } from "./network-access-copy.js";
import { channelOwnerGuidance, type ChannelOwner } from "./owner-copy.js";
import { channelPermissionCheckGuidance } from "./permission-check-copy.js";
import {
  spendHoldUserCopy,
  telegramResetTime,
  type ChannelSpendHold,
} from "./spend-hold-copy.js";
import {
  createConversationQueue,
  getOrCreateQueue,
  steerChannelTurn,
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
  ambient: boolean;
};

export interface TelegramConversationsPort {
  findAgentByConversation(conversationId: string): Promise<{
    agentId: string;
    authorizedBy: string;
    ambient: boolean;
  } | null>;
  bind(
    conversationId: string,
    agentId: string,
    authorizedBy: string,
  ): Promise<"bound" | "conflict">;
  listByAgent(agentId: string): Promise<string[]>;
  unbind(conversationId: string): Promise<void>;
  setAmbient(conversationId: string, ambient: boolean): Promise<void>;
}

export interface TelegramOwnerChatsPort {
  listAuthorizedBy(
    keycloakSub: string,
  ): Promise<{ conversationId: string; agentId: string }[]>;
}

export interface ChannelConversation {
  id: string;
  title: string;
}

export interface TelegramWorker extends ChannelWorker {
  type: ChannelType.Telegram;
  start(): Promise<void>;
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
  try {
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
  } catch {
    return false;
  }
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

interface TelegramBotIdentity {
  id: string;
  username: string | null;
  readsAllGroupMessages: boolean;
}

async function fetchTelegramBotIdentity(
  botToken: string,
): Promise<TelegramBotIdentity | null> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      ok: boolean;
      result?: {
        id: number;
        username?: string;
        can_read_all_group_messages?: boolean;
      };
    };
    if (!data.ok || !data.result) return null;
    return {
      id: String(data.result.id),
      username: data.result.username ?? null,
      readsAllGroupMessages: data.result.can_read_all_group_messages ?? false,
    };
  } catch {
    return null;
  }
}

export const TELEGRAM_COMMANDS = [
  { command: "bind", description: "Connect this chat to one of your agents" },
  { command: "unbind", description: "Disconnect this chat from its agent" },
  {
    command: "ambient",
    description: "Show or switch whether the agent reads every message",
  },
];

async function publishTelegramCommands(botToken: string): Promise<void> {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/setMyCommands`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commands: TELEGRAM_COMMANDS }),
      },
    );
    if (!res.ok) {
      getLogger().warn(
        { status: res.status },
        "telegram.commands.publish_failed",
      );
    }
  } catch (err) {
    getLogger().warn(
      { error: String(err) },
      "telegram.commands.publish_failed",
    );
  }
}

export interface ThreadLike {
  id: string;
  isDM: boolean;
  post(message: string | CardElement | { markdown: string }): Promise<unknown>;
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

function isCommand(
  text: string,
  command: string,
  botUsername: string | null,
): boolean {
  if (text === command || text.startsWith(`${command} `)) return true;
  if (!text.startsWith(`${command}@`)) return false;
  const addressed = text.slice(command.length + 1).split(/\s+/)[0] ?? "";
  return (
    botUsername !== null &&
    addressed.toLowerCase() === botUsername.toLowerCase()
  );
}

const EVERY_MESSAGE = /^/;

export function createTelegramMessageHandler(deps: {
  conversations: TelegramConversationsPort;
  isChatAdmin: (chatId: string, userId: string) => Promise<boolean>;
  canReadGroupMessages: (chatId: string) => Promise<boolean>;
  decodeChatId: (threadId: string) => string;
  fetchChatTitle: (chatId: string) => Promise<string>;
  oauthConfig: KeycloakOAuthConfig;
  pendingOAuthFlows: TtlStore<TelegramOAuthPending>;
  isTermsAccepted: (sub: string) => Promise<boolean>;
  ownerOf: (agentId: string) => Promise<string | null>;
  emit: (event: DomainEvent) => void;
  spendHold?: ChannelSpendHold;
  uiBaseUrl: string;
  brandName: string;
  botUsername: () => string | null;
  relay: (
    agentId: string,
    thread: ThreadLike,
    text: string,
    author: TelegramInboundMessage["author"],
    ambient: boolean,
  ) => void;
}) {
  async function denyNonAdmin(
    thread: ThreadLike,
    telegramUserId: string,
    action: "bind" | "unbind" | "ambient",
  ): Promise<boolean> {
    if (thread.isDM) return false;
    const isAdmin = await deps.isChatAdmin(
      deps.decodeChatId(thread.id),
      telegramUserId,
    );
    if (isAdmin) return false;
    channelDeny("telegram", {
      actor: null,
      reason: "not-group-admin",
      detail: { telegramUserId, threadId: thread.id, command: action },
    });
    await thread.post(`Only group admins can \`/${action}\`.`);
    return true;
  }

  async function handleBind(thread: ThreadLike, telegramUserId: string) {
    if (await denyNonAdmin(thread, telegramUserId, "bind")) return;

    const chat = telegramChatOf(thread.id);
    const binding = await deps.conversations.findAgentByConversation(chat);
    if (binding) {
      await thread.post(
        "This chat is already connected to an agent. Send `/unbind` first to reconnect.",
      );
      return;
    }

    const chatTitle = await deps.fetchChatTitle(deps.decodeChatId(thread.id));
    const { state: oauthState, codeVerifier, codeChallenge } = generatePkce();
    await deps.pendingOAuthFlows.set(oauthState, {
      telegramUserId,
      threadId: chat,
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

    const chat = telegramChatOf(thread.id);
    const binding = await deps.conversations.findAgentByConversation(chat);
    if (!binding) {
      await thread.post("This chat isn't connected to an agent.");
      return;
    }
    const ownerSub = await deps.ownerOf(binding.agentId);
    await deps.conversations.unbind(chat);
    securityLog("info", "channel.chat_unbound", {
      category: "authz-list",
      actor: null,
      actorKind: "external",
      surface: "telegram",
      agentId: binding.agentId,
      result: "success",
      detail: { conversationId: chat, byTelegramUserId: telegramUserId },
    });
    if (ownerSub)
      deps.emit({
        type: EventType.TelegramChatUnbound,
        ownerSub,
        agentId: binding.agentId,
      });
    await thread.post("Chat disconnected. Send `/bind` to connect it again.");
  }

  async function handleAmbient(
    thread: ThreadLike,
    telegramUserId: string,
    argument: string | undefined,
  ) {
    if (thread.isDM) {
      await thread.post(
        "In a direct chat every message reaches the agent, so there is no ambient mode to switch.",
      );
      return;
    }
    const chat = telegramChatOf(thread.id);
    const binding = await deps.conversations.findAgentByConversation(chat);
    if (!binding) {
      await thread.post("This chat isn't connected to an agent.");
      return;
    }
    if (argument !== "on" && argument !== "off") {
      await thread.post(
        `Ambient mode is ${
          binding.ambient
            ? "on — the agent reads every message here and may chime in without being mentioned"
            : "off — the agent only answers messages that mention it or reply to it"
        }. Send \`/ambient on\` or \`/ambient off\` to change it.`,
      );
      return;
    }
    if (await denyNonAdmin(thread, telegramUserId, "ambient")) return;

    const enable = argument === "on";
    if (enable === binding.ambient) {
      await thread.post(`Ambient mode is already ${argument}.`);
      return;
    }
    await deps.conversations.setAmbient(chat, enable);
    securityLog("info", "channel.ambient_toggled", {
      category: "authz-list",
      actor: null,
      actorKind: "external",
      surface: "telegram",
      agentId: binding.agentId,
      result: "success",
      detail: { conversationId: chat, telegramUserId, ambient: enable },
    });
    if (!enable) {
      await thread.post(
        "Ambient mode turned off — the agent now only answers messages that mention it or reply to it.",
      );
      return;
    }
    const privacyNote = (await deps.canReadGroupMessages(
      deps.decodeChatId(thread.id),
    ))
      ? ""
      : " Heads-up: this bot has Group Privacy on, so Telegram only shows it commands and replies to its own messages. Turn Group Privacy off in @BotFather and add the bot to this group again, or make the bot an admin here.";
    const termsNote = (await deps.isTermsAccepted(binding.authorizedBy))
      ? ""
      : ` Heads-up: the person who connected this chat hasn't accepted the Terms of Use at ${deps.uiBaseUrl} yet, so the agent stays silent until they do.`;
    await thread.post(
      `Ambient mode turned on — the agent now reads every message in this chat and may chime in without being mentioned when it can clearly help. It still answers mentions and replies as usual; send \`/ambient off\` to make it answer only those again.${privacyNote}${termsNote}`,
    );
  }

  return async function handleMessage(
    thread: ThreadLike,
    message: TelegramInboundMessage,
    addressed: boolean,
  ) {
    if (message.author.isMe) return;
    const text = message.text.trim();

    const self = deps.botUsername();
    if (isCommand(text, "/bind", self) || isCommand(text, "/start", self)) {
      await handleBind(thread, message.author.userId);
      return;
    }

    if (isCommand(text, "/unbind", self)) {
      await handleUnbind(thread, message.author.userId);
      return;
    }

    if (isCommand(text, "/ambient", self)) {
      await handleAmbient(
        thread,
        message.author.userId,
        text.split(/\s+/)[1]?.toLowerCase(),
      );
      return;
    }

    const ambient = !addressed && !thread.isDM;
    if (text === "") return;

    const binding = await deps.conversations.findAgentByConversation(
      telegramChatOf(thread.id),
    );
    if (!binding) {
      if (ambient) return;
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
          "This chat isn't connected to an agent. An admin needs to send `/bind`.",
        );
      }
      return;
    }
    if (ambient && !binding.ambient) return;

    if (!(await deps.isTermsAccepted(binding.authorizedBy))) {
      if (thread.isDM) {
        await thread.post(
          `Open ${deps.uiBaseUrl} to accept the Terms of Use before continuing.`,
        );
      }
      return;
    }
    const held = await deps.spendHold?.(binding.agentId);
    if (held) {
      if (ambient) return;
      await thread.post({
        markdown: spendHoldUserCopy(
          held,
          "This agent",
          deps.brandName,
          telegramResetTime(new Date()),
        ),
      });
      return;
    }
    deps.relay(binding.agentId, thread, message.text, message.author, ambient);
  };
}

export function createTelegramChat(deps: {
  adapter: Adapter;
  state: StateAdapter;
  logLevel?: LogLevel;
  handleMessage: (
    thread: ThreadLike,
    message: TelegramInboundMessage,
    addressed: boolean,
  ) => Promise<void>;
}): Chat {
  const chat = new Chat({
    userName: "platform",
    adapters: { telegram: deps.adapter },
    state: deps.state,
    concurrency: { strategy: "concurrent", maxConcurrent: 1 },
    ...(deps.logLevel ? { logger: deps.logLevel } : {}),
  });

  const dispatch = async (
    thread: ThreadLike,
    message: TelegramInboundMessage,
    addressed: boolean,
  ) => {
    try {
      await deps.handleMessage(thread, message, addressed);
    } catch (err) {
      getLogger().warn(
        { threadId: thread.id, error: String(err) },
        "telegram.inbound.failed",
      );
    }
  };

  chat.onDirectMessage((thread, message) => dispatch(thread, message, true));
  chat.onNewMention((thread, message) => dispatch(thread, message, true));
  chat.onSubscribedMessage((thread, message) =>
    dispatch(thread, message, message.isMention === true),
  );
  chat.onNewMessage(EVERY_MESSAGE, (thread, message) =>
    dispatch(thread, message, false),
  );
  chat.onSlashCommand(async (event) => {
    const channel = event.channel;
    const thread: ThreadLike = {
      id: channel.id,
      isDM: event.adapter.isDM?.(channel.id) ?? channel.isDM,
      post: (message) => channel.post(message),
    };
    await dispatch(
      thread,
      {
        text: [event.command, event.text].filter(Boolean).join(" ").trim(),
        author: {
          userId: event.user.userId,
          userName: event.user.userName,
          fullName: event.user.fullName,
          isMe: event.user.isMe ?? false,
        },
      },
      true,
    );
  });

  return chat;
}

export function createTelegramWorker(deps: {
  botToken: string;
  configuredBotUsername?: string | null;
  makeAcpClient: AcpClientFactory;
  state: StateAdapter;
  agents: () => AgentsService;
  conversations: TelegramConversationsPort & TelegramOwnerChatsPort;
  oauthConfig: KeycloakOAuthConfig;
  pendingOAuthFlows: TtlStore<TelegramOAuthPending>;
  isTermsAccepted: (sub: string) => Promise<boolean>;
  spendHold?: ChannelSpendHold;
  uiBaseUrl: string;
  brandName: string;
  logLevel?: LogLevel;
  emit?: (event: DomainEvent) => void;
  attendance: ChannelTurnAttendance;
  isChatAdmin?: (chatId: string, userId: string) => Promise<boolean>;
  ownerOf: (agentId: string) => Promise<string | null>;
  ownerDisplayName: (sub: string) => Promise<string | null>;
  settleMs?: number;
}): TelegramWorker {
  const emit = deps.emit ?? defaultEmit;
  const { botToken, makeAcpClient, agents, attendance, brandName } = deps;

  let bot: {
    chat: Chat;
    adapter: TelegramConversationAdapter;
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

  function relayToInstance(
    ...args: Parameters<typeof runTelegramTurn>
  ): ReturnType<typeof runTelegramTurn> {
    return inBackgroundSpan(
      "channel.turn",
      {
        "platform.channel": "telegram",
        "platform.channel.ambient": args[2].every((m) => m.ambient),
      },
      () => runTelegramTurn(...args),
    );
  }

  function groupContext(
    author: TelegramInboundMessage["author"],
    messages: TelegramPendingMessage[],
  ): string {
    const from = `${author.fullName} (@${author.userName}, id=${author.userId})`;
    if (messages.every((m) => m.ambient)) {
      return [
        `This is a group conversation, and you are reading along: ${messages.length > 1 ? "these messages were" : `this message from ${from} was`} not addressed to you — nobody mentioned you or replied to you.`,
        "A message that calls you by your name is addressed to you: answer it as you would a mention.",
        "Otherwise chime in only when you can clearly help — answer a question you know the answer to, pick up a task someone described, or flag a clear mistake.",
        `If in doubt, stay silent by calling \`${OUTBOUND_TOOL_PREFIX}no_reply_needed\`.`,
      ].join(" ");
    }
    return messages.length > 1
      ? 'This is a group conversation. The lines tagged "to you" mention you or reply to you: answer those. The others are context from the group.'
      : `This is a group conversation. The message is from ${from}, and it mentions you or replies to you: answer it.`;
  }

  async function resolveChannelOwner(
    agentId: string,
  ): Promise<ChannelOwner | null> {
    try {
      const owner = await deps.ownerOf(agentId);
      const name = owner ? await deps.ownerDisplayName(owner) : null;
      return name ? { name, slackUserId: null } : null;
    } catch (err) {
      getLogger().warn(
        { agentId, error: String(err) },
        "telegram.owner_lookup.failed",
      );
      return null;
    }
  }

  async function runTelegramTurn(
    agentId: string,
    thread: ThreadLike,
    messages: TelegramPendingMessage[],
    onSession?: (sessionId: string) => void,
  ) {
    lastThread.set(agentId, thread as Thread);

    const author = messages.at(-1)!.author;
    const ambientTurn = messages.every((m) => m.ambient);
    const batched = messages.length > 1;
    const text = batched
      ? messages
          .map(
            (m) =>
              `[@${m.author.userName}${thread.isDM || m.ambient ? "" : ", to you"}] ${m.text}`,
          )
          .join("\n")
      : messages[0]!.text;

    const who = batched
      ? `${messages.length} messages arrived together; each line is tagged with who sent it.${ambientTurn ? "" : " Answer them as one — reply once, covering all of them."}`
      : "";
    const context = (
      thread.isDM
        ? `This is a 1:1 direct message from ${author.fullName} (@${author.userName}, id=${author.userId}). Every message here is directed at you — always reply.`
        : groupContext(author, messages)
    ).concat(who ? ` ${who}` : "");

    const owner = await resolveChannelOwner(agentId);
    const prompt = [
      `You are participating in a Telegram conversation (chatId="${thread.id}").`,
      context,
      `To reply, call the \`${OUTBOUND_TOOL_PREFIX}send_channel_message\` tool with channel="telegram" and chatId="${thread.id}".`,
      "IMPORTANT: Your text output is NOT delivered to Telegram — only tool calls reach the user.",
      `To deliberately stay silent — a group message that isn't for you, or one already handled — call \`${OUTBOUND_TOOL_PREFIX}no_reply_needed\` instead of replying.`,
      "These instructions apply to the message they arrive with, not to this conversation as a whole — a later Telegram message carries its own. A message that arrives without them didn't come from Telegram: answer it where it arrived, in plain text, and post to Telegram for it only if you're asked to.",
      channelOwnerGuidance(owner, brandName),
      channelNetworkAccessGuidance(brandName),
      channelPermissionCheckGuidance,
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
          await acp.sendPrompt(prompt, { resumeSessionId: existing.sessionId });
          outcome = "success";
          return;
        } catch (err) {
          if (!(err instanceof AcpSessionLoadError)) throw err;
          process.stderr.write(
            `[telegram:${agentId}] resume failed, starting fresh: ${err}\n`,
          );
        }
      }
      await acp.sendPrompt(prompt, {
        platformMeta: {
          type: SessionType.ChannelTelegram,
          threadTs: thread.id,
        },
        ...(onSession ? { onSession } : {}),
      });
      outcome = "success";
    } catch (err) {
      const failure = classifyTurnFailure(err);
      failureReason = failure.reason;
      getLogger().warn(
        { agentId, reason: failureReason, error: String(err), ambientTurn },
        "telegram.turn.failed",
      );
      const sleeping = isAgentStoppedError(err) && !err.disabled;
      if (!ambientTurn && !sleeping)
        await thread
          .post(failure.copy({ uiBaseUrl: deps.uiBaseUrl, agentId }))
          .catch(() => {});
    } finally {
      releaseAttendance();
      annotateSpan({
        "platform.channel.outcome": outcome,
        ...(failureReason !== undefined && {
          "platform.channel.failure_reason": failureReason,
        }),
      });
      emitTurn(agentId, outcome, author.userId, ambientTurn, failureReason);
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
    let ambientTurnRunning = false;
    return createConversationQueue<TelegramPendingMessage>({
      settleMs: deps.settleMs ?? 0,
      canSteer: (message) => !message.ambient,
      runTurn: async (batch, onSession) => {
        ambientTurnRunning = batch.every((m) => m.ambient);
        try {
          await relayToInstance(
            agentId,
            batch.at(-1)!.thread,
            batch,
            onSession,
          );
        } finally {
          ambientTurnRunning = false;
        }
      },
      steer: async (sessionId, batch) => {
        if (ambientTurnRunning) return "refused";
        return steerChannelTurn(
          makeAcpClient(agentId),
          sessionId,
          steerFrame(batch),
          { surface: "telegram", fields: { agentId, threadId } },
        );
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
    ambient: boolean,
  ): void {
    const key = `${agentId}|${thread.id}`;
    void getOrCreateQueue(telegramQueues, key, () =>
      createChatQueue(key, agentId, thread.id),
    ).submit({ text, author, thread, ambient });
  }

  function emitTurn(
    agentId: string,
    outcome: TurnOutcome,
    telegramUserId: string,
    ambient: boolean,
    reason?: string,
  ) {
    emit({
      type: EventType.ChannelTurnRelayed,
      channel: "telegram",
      agentId,
      actorSub: null,
      externalActorId: telegramUserId,
      outcome,
      ...(ambient ? { ambient: true as const } : {}),
      ...(reason !== undefined ? { reason } : {}),
    });
  }

  const worker: TelegramWorker = {
    type: ChannelType.Telegram,

    botUsername() {
      return username;
    },

    async resolveIdentity() {
      if (username) return;
      const identity = await fetchTelegramBotIdentity(botToken);
      username = identity?.username ?? null;
    },

    async start() {
      if (bot) return;
      let adapter: TelegramConversationAdapter | null = null;
      try {
        const identity = await fetchTelegramBotIdentity(botToken);
        if (identity?.username) {
          if (
            username &&
            username.toLowerCase() !== identity.username.toLowerCase()
          ) {
            getLogger().warn(
              { configured: username, actual: identity.username },
              "telegram.bot_name_mismatch",
            );
          }
          username = identity.username;
        }
        if (identity && !identity.readsAllGroupMessages) {
          getLogger().warn(
            { bot: identity.username },
            "telegram.group_privacy_on",
          );
        }
        const isChatAdmin =
          deps.isChatAdmin ??
          ((chatId: string, userId: string) =>
            isTelegramChatAdmin(botToken, chatId, userId));
        const polling = new TelegramConversationAdapter({
          botToken,
          mode: "polling",
          mentionOnReply: true,
          ...(username ? { userName: username } : {}),
        });
        adapter = polling;
        const handleMessage = createTelegramMessageHandler({
          conversations: deps.conversations,
          isChatAdmin,
          canReadGroupMessages: async (chatId) => {
            const current = await fetchTelegramBotIdentity(botToken);
            return (
              !current ||
              current.readsAllGroupMessages ||
              (await isChatAdmin(chatId, current.id))
            );
          },
          decodeChatId: (threadId) => polling.decodeThreadId(threadId).chatId,
          fetchChatTitle: (chatId) => fetchTelegramChatTitle(botToken, chatId),
          oauthConfig: deps.oauthConfig,
          pendingOAuthFlows: deps.pendingOAuthFlows,
          isTermsAccepted: deps.isTermsAccepted,
          ownerOf: deps.ownerOf,
          emit,
          ...(deps.spendHold ? { spendHold: deps.spendHold } : {}),
          uiBaseUrl: deps.uiBaseUrl,
          brandName,
          botUsername: () => username,
          relay: enqueueTelegramTurn,
        });

        const chat = createTelegramChat({
          adapter: polling,
          state: deps.state,
          ...(deps.logLevel ? { logLevel: deps.logLevel } : {}),
          handleMessage,
        });

        await chat.initialize();
        await polling.startPolling();
        bot = { chat, adapter: polling };
        await publishTelegramCommands(botToken);
        process.stderr.write(
          `[telegram] platform bot started${username ? ` (@${username})` : ""}\n`,
        );
      } catch (err) {
        if (!bot && adapter) await adapter.stopPolling().catch(() => {});
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
        const binding = await deps.conversations.findAgentByConversation(
          telegramChatOf(conversationId),
        );
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

    async notifyPerson(keycloakSub, text) {
      if (!bot) return { sent: 0 };
      const chats = (
        await deps.conversations.listAuthorizedBy(keycloakSub)
      ).filter((chat) => isTelegramPrivateChat(chat.conversationId));
      let sent = 0;
      for (const chat of chats) {
        const result = await worker.postMessage(chat.agentId, text, {
          conversationId: chat.conversationId,
        });
        if ("ok" in result) sent++;
        else
          getLogger().warn(
            { conversationId: chat.conversationId, error: result.error },
            "telegram.notify_failed",
          );
      }
      return { sent };
    },
  };
  return worker;
}
