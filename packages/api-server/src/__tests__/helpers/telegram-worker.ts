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
  } = {},
) {
  const pending: TelegramUpdate[] = [];
  const sessions = [...(opts.sessions ?? [])];
  const prompts: Array<{
    prompt: string | ContentBlock[];
    opts: SendPromptOpts;
  }> = [];
  let nextId = 1;

  async function botApi(input: string | URL | Request): Promise<Response> {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = url.pathname.slice(url.pathname.lastIndexOf("/") + 1);
    if (method === "getMe") return okJson(BOT);
    if (method === "getUpdates") {
      if (pending.length === 0) await new Promise((r) => setTimeout(r, 5));
      return okJson(pending.splice(0));
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
      }),
      bind: async () => "bound" as const,
      listByAgent: async () => [],
      unbind: async () => {},
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

  return { worker, botApi, prompts, sendDirect };
}
