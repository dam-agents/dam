import { createMemoryTtlStore } from "../../core/ttl-store.js";
import { describe, it, expect, vi } from "vitest";
import { Message, type StateAdapter, type Lock } from "chat";
import { configureLogger } from "../../core/logger.js";
import {
  createTelegramChat,
  createTelegramMessageHandler,
  type TelegramInboundMessage,
} from "../../modules/channels/infrastructure/telegram.js";
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

function createMemoryState(): StateAdapter {
  const values = new Map<string, unknown>();
  const lists = new Map<string, unknown[]>();
  const locks = new Map<string, string>();
  const subscribed = new Set<string>();
  const queues = new Map<string, unknown[]>();
  let token = 0;
  return {
    async acquireLock(threadId) {
      if (locks.has(threadId)) return null;
      const value = `t${(token += 1)}`;
      locks.set(threadId, value);
      return { threadId, token: value } as Lock;
    },
    async releaseLock(lock) {
      if (locks.get(lock.threadId) === lock.token) locks.delete(lock.threadId);
    },
    async forceReleaseLock(threadId) {
      locks.delete(threadId);
    },
    async extendLock() {
      return true;
    },
    async appendToList(key, value) {
      lists.set(key, [...(lists.get(key) ?? []), value]);
    },
    async getList<T>(key: string) {
      return (lists.get(key) ?? []) as T[];
    },
    async get<T>(key: string) {
      return (values.get(key) ?? null) as T | null;
    },
    async set(key, value) {
      values.set(key, value);
    },
    async setIfNotExists(key, value) {
      if (values.has(key)) return false;
      values.set(key, value);
      return true;
    },
    async delete(key) {
      values.delete(key);
    },
    async isSubscribed(threadId) {
      return subscribed.has(threadId);
    },
    async subscribe(threadId) {
      subscribed.add(threadId);
    },
    async unsubscribe(threadId) {
      subscribed.delete(threadId);
    },
    async enqueue(threadId, entry) {
      const q = queues.get(threadId) ?? [];
      q.push(entry);
      queues.set(threadId, q);
      return q.length;
    },
    async dequeue(threadId) {
      const q = queues.get(threadId) ?? [];
      return (q.shift() ?? null) as never;
    },
    async queueDepth(threadId) {
      return (queues.get(threadId) ?? []).length;
    },
    async connect() {},
    async disconnect() {},
  };
}

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
  const handleMessage = createTelegramMessageHandler({
    conversations: {
      findAgentByConversation: async () =>
        opts.boundTo
          ? { agentId: opts.boundTo, authorizedBy: "kc|owner-1" }
          : null,
      bind: vi.fn(async () => "bound" as const),
      listByAgent: async () => [],
      unbind: vi.fn(async () => {}),
    },
    isChatAdmin: async () => true,
    decodeChatId: (threadId) => threadId.split(":")[1]!,
    fetchChatTitle: async () => "Team chat",
    oauthConfig,
    pendingOAuthFlows: createMemoryTtlStore<TelegramOAuthPending>(60_000),
    isTermsAccepted: async () => true,
    uiBaseUrl: "https://app.example",
    brandShort: "dam",
    relay: opts.relay as never,
  });

  const chat = createTelegramChat({
    adapter: adapter as never,
    state,
    brandShort: "dam",
    handleMessage: async (thread, message, subscribe) => {
      seen.push(message.text);
      await handleMessage(thread, message, subscribe);
    },
  });

  await chat.initialize();
  return { chat, adapter, state, posts, seen };
}

const DM_THREAD = "telegram:4242";
const GROUP_THREAD = "telegram:-100777";

describe("telegram Chat SDK routing", () => {
  it("answers a command that arrives while an agent turn is still running", async () => {
    let releaseTurn: () => void = () => {};
    const turnRunning = new Promise<void>((resolve) => {
      releaseTurn = resolve;
    });
    let turnStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      turnStarted = resolve;
    });

    const { chat, adapter, posts, seen } = await harness({
      boundTo: "agent-1",
      relay: async () => {
        turnStarted();
        await turnRunning;
      },
    });

    chat.processMessage(
      adapter as never,
      DM_THREAD,
      makeMessage(DM_THREAD, "howdy", "m-1"),
    );
    await started;

    await chat.processMessage(
      adapter as never,
      DM_THREAD,
      makeMessage(DM_THREAD, "/dam unbind", "m-2"),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(seen).toEqual(["howdy", "/dam unbind"]);
    expect(posts.join("\n")).toContain("Chat disconnected");

    releaseTurn();
  });

  it("delivers a bare command in a DM when no turn is in flight", async () => {
    const { chat, adapter, seen } = await harness({
      boundTo: "agent-1",
      relay: async () => {},
    });

    await chat.processMessage(
      adapter as never,
      DM_THREAD,
      makeMessage(DM_THREAD, "/dam unbind", "m-1"),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(seen).toEqual(["/dam unbind"]);
  });

  it("delivers a bare command in an unbound group", async () => {
    const { chat, adapter, posts, seen } = await harness({
      boundTo: null,
      relay: async () => {},
    });

    await chat.processMessage(
      adapter as never,
      GROUP_THREAD,
      makeMessage(GROUP_THREAD, "/dam bind", "m-1"),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(seen).toEqual(["/dam bind"]);
    expect(posts.join("\n")).toContain("Connect an agent");
  });

  it("stays silent on ordinary chatter in an unbound group", async () => {
    const { chat, adapter, posts, seen } = await harness({
      boundTo: null,
      relay: async () => {},
    });

    await chat.processMessage(
      adapter as never,
      GROUP_THREAD,
      makeMessage(GROUP_THREAD, "howdy", "m-1"),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(seen).toEqual([]);
    expect(posts).toEqual([]);
  });
});
