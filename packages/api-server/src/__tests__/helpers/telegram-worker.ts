import type { AgentsService } from "api-server-api";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { TelegramUpdate, TelegramUser } from "@chat-adapter/telegram";
import { createMemoryTtlStore } from "../../core/ttl-store.js";
import type {
  AcpClient,
  AcpSessionInfo,
  SendPromptOpts,
} from "../../core/acp-client.js";
import { createTelegramWorker } from "../../modules/channels/infrastructure/telegram.js";
import type { TelegramOAuthPending } from "../../modules/channels/infrastructure/telegram-flows.js";
import { createMemoryState } from "./chat-state.js";
import { stubTurnAttendance } from "./turn-attendance.js";

const BOT: TelegramUser = {
  id: 4242,
  is_bot: true,
  first_name: "Krodo",
  username: "krodo_bot",
};

const okJson = (result: unknown) =>
  new Response(JSON.stringify({ ok: true, result }), {
    headers: { "content-type": "application/json" },
  });

/**
 * UNIT_BOUNDARY_DESCRIPTION: The real Telegram worker, its Chat SDK adapter in
 * polling mode, and one agent bound to every chat, over a stubbed Bot API.
 * Specs hand over updates the way getUpdates would and read the prompts the
 * relay sends, so the stub deps for createTelegramWorker and the Bot API
 * replies are spelled out in one place. Install `botApi` as the global fetch
 * before `worker.start()`.
 */
export function telegramWorkerHarness(
  opts: {
    sessions?: AcpSessionInfo[];
    turn?: () => Promise<unknown>;
    steer?: AcpClient["steer"];
    ambient?: boolean;
    groupPrivacy?: { on: boolean };
  } = {},
) {
  const pending: TelegramUpdate[] = [];
  const sessions = [...(opts.sessions ?? [])];
  const prompts: Array<{
    prompt: string | ContentBlock[];
    opts: SendPromptOpts;
  }> = [];
  const posts: string[] = [];
  let nextId = 1;

  async function botApi(
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = url.pathname.slice(url.pathname.lastIndexOf("/") + 1);
    if (method === "getMe") {
      return okJson({
        ...BOT,
        can_read_all_group_messages: !(opts.groupPrivacy?.on ?? true),
      });
    }
    if (method === "getUpdates") {
      if (pending.length === 0) await new Promise((r) => setTimeout(r, 5));
      return okJson(pending.splice(0));
    }
    if (method === "getChatMember") {
      const isBot = url.searchParams.get("user_id") === String(BOT.id);
      return okJson({ status: isBot ? "member" : "administrator" });
    }
    if (method === "sendMessage" && typeof init?.body === "string") {
      posts.push((JSON.parse(init.body) as { text?: string }).text ?? "");
    }
    return okJson({ ...BOT, message_id: (nextId += 1), date: 0 });
  }

  const acp: AcpClient = {
    listSessions: async () => [...sessions],
    sendPrompt: async (prompt, sendOpts) => {
      prompts.push({ prompt, opts: sendOpts });
      if (!("resumeSessionId" in sendOpts)) {
        const sessionId = `s-${sessions.length + 1}`;
        sessions.push({ sessionId, platform: sendOpts.platformMeta ?? null });
        sendOpts.onSession?.(sessionId);
      }
      await opts.turn?.();
      return "the answer";
    },
    steer: opts.steer ?? (async () => "unsupported" as const),
    triggerSession: () => Promise.reject(new Error("unused")),
    turnStatus: async () => "unknown" as const,
  };

  const worker = createTelegramWorker({
    botToken: "4242:test",
    makeAcpClient: () => acp,
    state: createMemoryState(),
    agents: () => ({ ensureReady: async () => {} }) as unknown as AgentsService,
    conversations: {
      findAgentByConversation: async () => ({
        agentId: "agent-1",
        authorizedBy: "kc|owner-1",
        ambient: opts.ambient ?? false,
      }),
      bind: async () => "bound" as const,
      listByAgent: async () => [],
      unbind: async () => {},
      setAmbient: async () => {},
    },
    oauthConfig: {
      keycloakExternalUrl: "https://kc.example",
      keycloakUrl: "https://kc.internal",
      keycloakRealm: "platform",
      keycloakClientId: "telegram",
      callbackUrl: "https://app.example/api/telegram/oauth/callback",
    },
    pendingOAuthFlows: createMemoryTtlStore<TelegramOAuthPending>(60_000),
    isTermsAccepted: async () => true,
    uiBaseUrl: "https://app.example",
    brandName: "Platform",
    emit: () => {},
    attendance: stubTurnAttendance(),
  });

  function sendDirect(from: TelegramUser, text: string) {
    pending.push({
      update_id: (nextId += 1),
      message: {
        message_id: (nextId += 1),
        date: 0,
        text,
        from,
        chat: { id: from.id, type: "private", first_name: from.first_name },
      },
    });
  }

  function sendGroup(
    from: TelegramUser,
    text: string,
    options: { replyToBot?: boolean } = {},
  ) {
    const chat = { id: -1001234567890, type: "supergroup" as const };
    const messageId = (nextId += 1);
    const command = /^\/\S+/.exec(text)?.[0];
    pending.push({
      update_id: (nextId += 1),
      message: {
        message_id: messageId,
        date: 0,
        text,
        from,
        chat,
        ...(command && {
          entities: [
            { offset: 0, length: command.length, type: "bot_command" },
          ],
        }),
        ...(options.replyToBot && {
          message_thread_id: messageId - 1,
          reply_to_message: {
            message_id: messageId - 1,
            date: 0,
            text: "an earlier answer",
            from: BOT,
            chat,
          },
        }),
      },
    });
  }

  return { worker, botApi, prompts, posts, sendDirect, sendGroup };
}
