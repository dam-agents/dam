import { createMemoryTtlStore } from "../../core/ttl-store.js";
import { describe, it, expect, vi } from "vitest";
import { Message } from "chat";
import { createTelegramAdapter } from "@chat-adapter/telegram";
import { configureLogger } from "../../core/logger.js";
import { createMemoryState } from "../helpers/chat-state.js";
import {
  createTelegramChat,
  createTelegramMessageHandler,
  type TelegramInboundMessage,
} from "../../modules/channels/infrastructure/telegram.js";
import { TelegramConversationAdapter } from "../../modules/channels/infrastructure/telegram-conversation-adapter.js";
import type { TelegramOAuthPending } from "../../modules/channels/infrastructure/telegram-flows.js";
import type { KeycloakOAuthConfig } from "../../modules/channels/infrastructure/identity-oauth.js";

configureLogger({ level: "error", write: () => {} });

const oauthConfig: KeycloakOAuthConfig = {
  keycloakExternalUrl: "https://kc.example",
  keycloakUrl: "https://kc.internal",
  keycloakRealm: "platform",
  keycloakClientId: "telegram",
  callbackUrl: "https://app.example/api/telegram/oauth/callback",
};

function createFakeTelegramAdapter(posts: string[]) {
  return {
    name: "telegram",
    lockScope: "channel" as const,
    persistMessageHistory: false,
    async initialize() {},
    async shutdown() {},
    isDM(threadId: string) {
      return !threadId.split(":")[1]!.startsWith("-");
    },
    channelIdFromThreadId(threadId: string) {
      const chatId = threadId.split(":")[1]!;
      return `telegram:${chatId}`;
    },
    async postMessage(_threadId: string, message: unknown) {
      posts.push(
        typeof message === "string" ? message : JSON.stringify(message),
      );
      return { id: `m${posts.length}`, threadId: _threadId };
    },
    async fetchThread(threadId: string) {
      return {
        id: threadId,
        channelId: this.channelIdFromThreadId(threadId),
        channelName: "chat",
        isDM: this.isDM(threadId),
      };
    },
  };
}

function makeMessage(threadId: string, text: string, id: string) {
  return new Message({
    id,
    threadId,
    text,
    attachments: [],
    formatted: { type: "root", children: [] },
    raw: {},
    author: {
      userId: "tg-7",
      userName: "jane",
      fullName: "Jane Doe",
      isBot: false,
      isMe: false,
    },
    metadata: { dateSent: new Date(0), edited: false },
  });
}

async function harness(opts: {
  boundTo: string | null;
  isAdmin?: boolean;
  termsAccepted?: boolean;
  relay: (
    agentId: string,
    thread: unknown,
    text: string,
    author: TelegramInboundMessage["author"],
  ) => Promise<void>;
}) {
  const posts: string[] = [];
  const adapter = createFakeTelegramAdapter(posts);
  const state = createMemoryState();
  const seen: string[] = [];
  const addressed: boolean[] = [];
  const handleMessage = createTelegramMessageHandler({
    conversations: {
      findAgentByConversation: async () =>
        opts.boundTo
          ? {
              agentId: opts.boundTo,
              authorizedBy: "kc|owner-1",
              ambient: false,
            }
          : null,
      bind: vi.fn(async () => "bound" as const),
      listByAgent: async () => [],
      unbind: vi.fn(async () => {}),
      setAmbient: vi.fn(async () => {}),
    },
    isChatAdmin: async () => opts.isAdmin ?? true,
    canReadGroupMessages: async () => true,
    decodeChatId: (threadId) => threadId.split(":")[1]!,
    fetchChatTitle: async () => "Team chat",
    oauthConfig,
    pendingOAuthFlows: createMemoryTtlStore<TelegramOAuthPending>(60_000),
    isTermsAccepted: async () => opts.termsAccepted ?? true,
    uiBaseUrl: "https://app.example",
    brandName: "Platform",
    botUsername: () => "krodo_bot",
    relay: opts.relay as never,
  });

  const chat = createTelegramChat({
    adapter: adapter as never,
    state,
    handleMessage: async (thread, message, isAddressed) => {
      seen.push(message.text);
      addressed.push(isAddressed);
      await handleMessage(thread, message, isAddressed);
    },
  });

  await chat.initialize();
  return { chat, adapter, state, posts, seen, addressed };
}

const DM_THREAD = "telegram:4242";
const GROUP_THREAD = "telegram:-100777";

describe("telegram Chat SDK routing", () => {
  it("delivers a bare command in a DM when no turn is in flight", async () => {
    const { chat, adapter, seen } = await harness({
      boundTo: "agent-1",
      relay: async () => {},
    });

    await chat.processMessage(
      adapter as never,
      DM_THREAD,
      makeMessage(DM_THREAD, "/unbind", "m-1"),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(seen).toEqual(["/unbind"]);
  });

  it("delivers a bare command in an unbound group", async () => {
    const { chat, adapter, posts, seen } = await harness({
      boundTo: null,
      relay: async () => {},
    });

    await chat.processMessage(
      adapter as never,
      GROUP_THREAD,
      makeMessage(GROUP_THREAD, "/bind", "m-1"),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(seen).toEqual(["/bind"]);
    expect(posts.join("\n")).toContain("Connect an agent");
  });

  /**
   * TEST_SCENARIO: Ordinary group chatter reaches the handler marked as not
   * addressed, so a binding with ambient mode on can read along without a
   * first mention. In a group no agent is bound to, the bot stays silent.
   */
  it("hands group chatter over as not addressed and stays silent in an unbound group", async () => {
    const { chat, adapter, posts, seen, addressed } = await harness({
      boundTo: null,
      relay: async () => {},
    });

    await chat.processMessage(
      adapter as never,
      GROUP_THREAD,
      makeMessage(GROUP_THREAD, "howdy", "m-1"),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(seen).toEqual(["howdy"]);
    expect(addressed).toEqual([false]);
    expect(posts).toEqual([]);
  });
});

describe("telegram /start probe", () => {
  async function send(
    h: Awaited<ReturnType<typeof harness>>,
    threadId: string,
    text: string,
    id = "s-1",
  ) {
    await h.chat.processMessage(
      h.adapter as never,
      threadId,
      makeMessage(threadId, text, id),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  it("offers the bind link in an unbound DM", async () => {
    const h = await harness({ boundTo: null, relay: async () => {} });
    await send(h, DM_THREAD, "/start");
    expect(h.seen).toEqual(["/start"]);
    expect(h.posts.join("\n")).toContain("Connect an agent");
  });

  it("reports the existing binding in a bound DM", async () => {
    const h = await harness({ boundTo: "agent-1", relay: async () => {} });
    await send(h, DM_THREAD, "/start");
    expect(h.posts.join("\n")).toContain("already connected");
  });

  it("carries a deep-link payload into the bind flow", async () => {
    const h = await harness({ boundTo: null, relay: async () => {} });
    await send(h, DM_THREAD, "/start abc123");
    expect(h.seen).toEqual(["/start abc123"]);
    expect(h.posts.join("\n")).toContain("Connect an agent");
  });

  it("answers /start@botname", async () => {
    const h = await harness({ boundTo: null, relay: async () => {} });
    await send(h, DM_THREAD, "/start@krodo_bot");
    expect(h.posts.join("\n")).toContain("Connect an agent");
  });

  it("offers the bind link in an unbound group", async () => {
    const h = await harness({ boundTo: null, relay: async () => {} });
    await send(h, GROUP_THREAD, "/start");
    expect(h.seen).toEqual(["/start"]);
    expect(h.posts.join("\n")).toContain("Connect an agent");
  });

  it("refuses a non-admin in an unbound group", async () => {
    const h = await harness({
      boundTo: null,
      isAdmin: false,
      relay: async () => {},
    });
    await send(h, GROUP_THREAD, "/start");
    expect(h.posts.join("\n")).toContain("Only group admins");
  });
});

describe("telegram slash command routing", () => {
  async function sendCommand(
    h: Awaited<ReturnType<typeof harness>>,
    threadId: string,
    command: string,
    text = "",
  ) {
    h.chat.processSlashCommand(
      {
        adapter: h.adapter as never,
        channelId: threadId,
        command,
        text,
        user: {
          userId: "tg-7",
          userName: "jane",
          fullName: "Jane Doe",
          isBot: false,
          isMe: false,
        },
        raw: {},
      } as never,
      undefined,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  it("treats a slash command in a DM as a DM, not a group", async () => {
    const h = await harness({
      boundTo: null,
      isAdmin: false,
      relay: async () => {},
    });
    await sendCommand(h, DM_THREAD, "/bind");
    const posted = h.posts.join("\n");
    expect(posted).not.toContain("Only group admins");
    expect(posted).toContain("Connect an agent");
  });

  it("still applies the admin gate to a slash command in a group", async () => {
    const h = await harness({
      boundTo: null,
      isAdmin: false,
      relay: async () => {},
    });
    await sendCommand(h, GROUP_THREAD, "/bind");
    expect(h.posts.join("\n")).toContain("Only group admins");
  });

  it("unbinds from a slash command", async () => {
    const h = await harness({ boundTo: "agent-1", relay: async () => {} });
    await sendCommand(h, DM_THREAD, "/unbind");
    expect(h.posts.join("\n")).toContain("Chat disconnected");
  });
});

describe("telegram adapter update routing", () => {
  it("routes a real command update through the adapter to the command handler", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            result: { id: 4242, username: "krodo_bot", message_id: 1 },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    try {
      const adapter = createTelegramAdapter({
        botToken: "4242:test",
        mode: "webhook",
        allowUnverifiedWebhooks: true,
      });
      const seen: string[] = [];
      const chat = createTelegramChat({
        adapter: adapter as never,
        state: createMemoryState(),
        handleMessage: async (_thread, message) => {
          seen.push(message.text);
        },
      });
      await chat.initialize();

      await adapter.handleWebhook(
        new Request("https://example.test/telegram", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            update_id: 1,
            message: {
              message_id: 7,
              date: 0,
              text: "/bind",
              entities: [{ offset: 0, length: 5, type: "bot_command" }],
              from: { id: 7779420671, is_bot: false, first_name: "Tom" },
              chat: { id: 7779420671, type: "private", first_name: "Tom" },
            },
          }),
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(seen).toEqual(["/bind"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("telegram conversation of a group message", () => {
  const BOT = { id: 4242, is_bot: true, first_name: "Krodo" };
  const GROUP = { id: -1001234567890, type: "supergroup", title: "Team" };
  const JANE = { id: 7, is_bot: false, first_name: "Jane" };
  const mention = (text: string) => ({
    date: 0,
    text: `@krodo_bot ${text}`,
    entities: [{ offset: 0, length: 10, type: "mention" }],
    from: JANE,
  });

  async function routedThreadIds(message: object): Promise<string[]> {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            result: { ...BOT, username: "krodo_bot", message_id: 1 },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    try {
      const adapter = new TelegramConversationAdapter({
        botToken: "4242:test",
        mode: "webhook",
        allowUnverifiedWebhooks: true,
      });
      const seen: string[] = [];
      const chat = createTelegramChat({
        adapter: adapter as never,
        state: createMemoryState(),
        handleMessage: async (thread) => {
          seen.push(thread.id);
        },
      });
      await chat.initialize();
      await adapter.handleWebhook(
        new Request("https://example.test/telegram", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ update_id: 1, message }),
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      return seen;
    } finally {
      vi.unstubAllGlobals();
    }
  }

  /**
   * TEST_SCENARIO: The reported bug. In a supergroup Telegram puts a thread id
   * on every reply, and the stock adapter made that reply a conversation of
   * its own, which no binding knew. A reply belongs to its chat.
   */
  it("routes a reply in a supergroup to its chat", async () => {
    const seen = await routedThreadIds({
      ...mention("what about this?"),
      message_id: 13,
      message_thread_id: 12,
      reply_to_message: {
        message_id: 12,
        date: 0,
        text: "an earlier answer",
        from: BOT,
        chat: GROUP,
      },
      chat: GROUP,
    });
    expect(seen).toEqual([`telegram:${GROUP.id}`]);
  });

  /**
   * TEST_SCENARIO: A forum topic is a conversation of its own: its messages
   * keep the topic, so the agent's answer is posted back into that topic.
   */
  it("keeps a forum topic as its own conversation", async () => {
    const seen = await routedThreadIds({
      ...mention("in a topic"),
      message_id: 15,
      message_thread_id: 99,
      is_topic_message: true,
      chat: { ...GROUP, is_forum: true },
    });
    expect(seen).toEqual([`telegram:${GROUP.id}:99`]);
  });
});
