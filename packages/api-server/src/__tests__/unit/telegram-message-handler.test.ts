import { createInspectableTtlStore } from "../helpers/ttl-store.js";
import { describe, it, expect, vi } from "vitest";
import { configureLogger } from "../../core/logger.js";
import {
  TELEGRAM_COMMANDS,
  createTelegramMessageHandler,
  type ThreadLike,
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

function makeThread(opts?: { isDM?: boolean; id?: string }) {
  const posts: string[] = [];
  const thread: ThreadLike & { posts: string[] } = {
    id: opts?.id ?? "chat-42",
    isDM: opts?.isDM ?? false,
    posts,
    async post(message) {
      posts.push(
        typeof message === "string" ? message : JSON.stringify(message),
      );
    },
  };
  return thread;
}

function harness(opts?: {
  boundTo?: string | null;
  bindings?: Record<string, string>;
  ambient?: boolean;
  isAdmin?: boolean;
  termsAccepted?: boolean;
  readsGroupMessages?: boolean;
}) {
  const { store: pendingOAuthFlows, map: pendingOAuthFlowsMap } =
    createInspectableTtlStore<TelegramOAuthPending>();
  const unbind = vi.fn(async () => {});
  const bind = vi.fn(async () => "bound" as const);
  const setAmbient = vi.fn(async () => {});
  const relay = vi.fn();
  const agentFor = (conversationId: string) =>
    opts?.bindings ? opts.bindings[conversationId] : opts?.boundTo;

  const handle = createTelegramMessageHandler({
    conversations: {
      findAgentByConversation: async (conversationId) => {
        const agentId = agentFor(conversationId);
        return agentId
          ? {
              agentId,
              authorizedBy: "kc|owner-1",
              ambient: opts?.ambient ?? false,
            }
          : null;
      },
      bind,
      listByAgent: async () => [],
      unbind,
      setAmbient,
    },
    isChatAdmin: async () => opts?.isAdmin ?? true,
    canReadGroupMessages: async () => opts?.readsGroupMessages ?? true,
    decodeChatId: (threadId) => threadId,
    fetchChatTitle: async () => "Team chat",
    oauthConfig,
    pendingOAuthFlows,
    isTermsAccepted: async () => opts?.termsAccepted ?? true,
    uiBaseUrl: "https://app.example",
    brandName: "Platform",
    botUsername: () => "krodo_bot",
    relay,
  });

  return {
    handle,
    pendingOAuthFlows,
    pendingOAuthFlowsMap,
    unbind,
    bind,
    setAmbient,
    relay,
  };
}

const author = (userId = "tg-7") => ({
  userId,
  userName: "jane",
  fullName: "Jane Doe",
  isMe: false,
});

describe("telegram message handler", () => {
  it("denies `/bind` from a non-admin in a group", async () => {
    const h = harness({ isAdmin: false });
    const thread = makeThread();
    await h.handle(thread, { text: "/bind", author: author() }, true);
    expect(thread.posts.join("\n")).toContain("Only group admins can `/bind`.");
    expect(h.pendingOAuthFlowsMap.size).toBe(0);
  });

  it("tells an already-bound chat to unbind first", async () => {
    const h = harness({ boundTo: "agent-1" });
    const thread = makeThread();
    await h.handle(thread, { text: "/bind", author: author() }, true);
    expect(thread.posts.join("\n")).toContain("`/unbind` first");
    expect(h.pendingOAuthFlowsMap.size).toBe(0);
  });

  it("mints a pending OAuth flow (no agent, with chat title) and posts the link", async () => {
    const h = harness();
    const thread = makeThread({ isDM: true });
    await h.handle(thread, { text: "/bind", author: author() }, true);

    expect(h.pendingOAuthFlowsMap.size).toBe(1);
    const pending = [...h.pendingOAuthFlowsMap.values()][0]!;
    expect(pending).toMatchObject({
      telegramUserId: "tg-7",
      threadId: "chat-42",
      chatTitle: "Team chat",
    });
    const posted = thread.posts.join("\n");
    expect(posted).toContain("Connect this chat to one of your agents");
    expect(posted).toContain("link-button");
    expect(posted).toContain("https://kc.example");
  });

  it("unbinds on `/unbind` from a bound chat", async () => {
    const h = harness({ boundTo: "agent-1" });
    const thread = makeThread();
    await h.handle(thread, { text: "/unbind", author: author() }, true);
    expect(h.unbind).toHaveBeenCalledWith("chat-42");
    expect(thread.posts.join("\n")).toContain("Chat disconnected");
  });

  it("treats `/start` and an `@bot` suffix as the bind command", async () => {
    for (const text of [
      "/start",
      "/bind@krodo_bot",
      "/start deep-link",
      "/start@krodo_bot login",
    ]) {
      const h = harness();
      const thread = makeThread({ isDM: true });
      await h.handle(thread, { text, author: author() }, true);
      expect(h.pendingOAuthFlowsMap.size).toBe(1);
      expect(thread.posts.join("\n")).toContain(
        "Connect this chat to one of your agents",
      );
    }
  });

  it("no longer treats `/login` or `/logout` as commands", async () => {
    const loginH = harness();
    const dm = makeThread({ isDM: true });
    await loginH.handle(dm, { text: "/login", author: author() }, true);
    expect(loginH.pendingOAuthFlowsMap.size).toBe(0);
    expect(dm.posts.join("\n")).toContain("isn't connected to an agent");

    const logoutH = harness({ boundTo: "agent-1" });
    const bound = makeThread();
    await logoutH.handle(bound, { text: "/logout", author: author() }, true);
    expect(logoutH.unbind).not.toHaveBeenCalled();
    expect(logoutH.relay).toHaveBeenCalled();
  });

  it("stays silent in unbound groups, prompts in unbound DMs", async () => {
    const h = harness({ boundTo: null });

    const group = makeThread();
    await h.handle(group, { text: "hello", author: author() }, true);
    expect(group.posts).toEqual([]);

    const dm = makeThread({ isDM: true });
    await h.handle(dm, { text: "hello", author: author() }, true);
    expect(dm.posts.join("\n")).toContain("isn't connected to an agent");
    expect(h.relay).not.toHaveBeenCalled();
  });

  it("blocks the turn until the binding OWNER accepts the terms", async () => {
    const h = harness({ boundTo: "agent-1", termsAccepted: false });
    const dm = makeThread({ isDM: true });
    await h.handle(dm, { text: "hello", author: author() }, true);
    expect(dm.posts.join("\n")).toContain("Terms of Use");
    expect(h.relay).not.toHaveBeenCalled();
  });

  it("relays an addressed message in a bound group to its agent", async () => {
    const h = harness({ boundTo: "agent-1" });
    const thread = makeThread();
    await h.handle(thread, { text: "hello agent", author: author() }, true);
    expect(h.relay).toHaveBeenCalledWith(
      "agent-1",
      thread,
      "hello agent",
      expect.objectContaining({ userId: "tg-7" }),
      false,
    );
  });

  it("ignores the bot's own messages", async () => {
    const h = harness({ boundTo: "agent-1" });
    const thread = makeThread();
    await h.handle(
      thread,
      { text: "hi", author: { ...author(), isMe: true } },
      true,
    );
    expect(h.relay).not.toHaveBeenCalled();
  });

  it("handles every command it advertises in the Telegram menu", async () => {
    for (const { command } of TELEGRAM_COMMANDS) {
      const h = harness({ boundTo: "agent-1" });
      const thread = makeThread({ isDM: true });
      await h.handle(thread, { text: `/${command}`, author: author() }, true);
      expect(h.relay).not.toHaveBeenCalled();
      expect(thread.posts.length).toBeGreaterThan(0);
    }
  });

  it("ignores a command addressed to a different bot", async () => {
    const h = harness({ boundTo: "agent-1" });
    const thread = makeThread({ isDM: true });
    await h.handle(
      thread,
      { text: "/unbind@some_other_bot", author: author() },
      true,
    );
    expect(h.unbind).not.toHaveBeenCalled();
    expect(thread.posts).toEqual([]);
    expect(h.relay).toHaveBeenCalled();
  });
});

describe("telegram binding covers the whole chat", () => {
  const CHAT = "telegram:-100777";
  const TOPIC = "telegram:-100777:99";

  /**
   * TEST_SCENARIO: The reported bug. A forum topic message carries its topic
   * in its conversation id, and the lookup matched only the exact id `/bind`
   * stored, so the message was dropped without a word. It must reach the
   * agent bound to its chat, and stay in its topic so the answer goes there.
   */
  it("relays a forum topic message to the agent bound to its chat", async () => {
    const h = harness({ bindings: { [CHAT]: "agent-1" } });
    const thread = makeThread({ id: TOPIC });
    await h.handle(thread, { text: "hi", author: author() }, true);
    expect(h.relay).toHaveBeenCalledWith(
      "agent-1",
      thread,
      "hi",
      expect.objectContaining({ userId: "tg-7" }),
      false,
    );
  });

  /**
   * TEST_SCENARIO: `/bind` sent inside a topic connects the chat, not only
   * that topic, so every topic of the group reaches the agent.
   */
  it("binds the chat when `/bind` is sent in a forum topic", async () => {
    const h = harness({ bindings: {} });
    const thread = makeThread({ id: TOPIC });
    await h.handle(thread, { text: "/bind", author: author() }, true);
    const pending = [...h.pendingOAuthFlowsMap.values()][0]!;
    expect(pending.threadId).toBe(CHAT);
  });

  /**
   * TEST_SCENARIO: `/unbind` sent inside a topic releases the chat's binding,
   * since that is the one binding the topic's messages reach.
   */
  it("unbinds the chat when `/unbind` is sent in a forum topic", async () => {
    const h = harness({ bindings: { [CHAT]: "agent-1" } });
    const thread = makeThread({ id: TOPIC });
    await h.handle(thread, { text: "/unbind", author: author() }, true);
    expect(h.unbind).toHaveBeenCalledWith(CHAT);
    expect(thread.posts.join("\n")).toContain("Chat disconnected");
  });
});

describe("telegram ambient mode", () => {
  const CHAT = "telegram:-100777";

  /**
   * TEST_SCENARIO: Ambient is off by default, as on Slack: a group message
   * that neither mentions the bot nor replies to it does not reach the
   * agent, and the bot says nothing about it.
   */
  it("drops a group message nobody addressed while ambient is off", async () => {
    const h = harness({ bindings: { [CHAT]: "agent-1" } });
    const thread = makeThread({ id: CHAT });
    await h.handle(thread, { text: "lunch at noon?", author: author() }, false);
    expect(h.relay).not.toHaveBeenCalled();
    expect(thread.posts).toEqual([]);
  });

  /**
   * TEST_SCENARIO: With ambient on, the same message reaches the agent as a
   * read-along message, so the turn tells the agent it may stay silent.
   */
  it("relays a group message nobody addressed as ambient when ambient is on", async () => {
    const h = harness({ bindings: { [CHAT]: "agent-1" }, ambient: true });
    const thread = makeThread({ id: CHAT });
    await h.handle(thread, { text: "lunch at noon?", author: author() }, false);
    expect(h.relay).toHaveBeenCalledWith(
      "agent-1",
      thread,
      "lunch at noon?",
      expect.objectContaining({ userId: "tg-7" }),
      true,
    );
  });

  /**
   * TEST_SCENARIO: In a group no agent is bound to, ordinary chatter reaches
   * the handler too, and the bot must stay silent there.
   */
  it("stays silent on chatter in a group with no binding", async () => {
    const h = harness({ bindings: {} });
    const thread = makeThread({ id: CHAT });
    await h.handle(thread, { text: "lunch at noon?", author: author() }, false);
    expect(h.relay).not.toHaveBeenCalled();
    expect(thread.posts).toEqual([]);
  });

  it("reports the mode to anyone on a bare `/ambient`", async () => {
    const h = harness({ bindings: { [CHAT]: "agent-1" }, isAdmin: false });
    const thread = makeThread({ id: CHAT });
    await h.handle(thread, { text: "/ambient", author: author() }, true);
    expect(thread.posts.join("\n")).toContain("Ambient mode is off");
    expect(h.setAmbient).not.toHaveBeenCalled();
  });

  it("lets only a group admin switch ambient mode", async () => {
    const h = harness({ bindings: { [CHAT]: "agent-1" }, isAdmin: false });
    const thread = makeThread({ id: CHAT });
    await h.handle(thread, { text: "/ambient on", author: author() }, true);
    expect(thread.posts.join("\n")).toContain(
      "Only group admins can `/ambient`.",
    );
    expect(h.setAmbient).not.toHaveBeenCalled();
  });

  /**
   * TEST_SCENARIO: An admin turns ambient on for the chat. When Telegram's
   * Group Privacy hides ordinary messages from the bot here, the reply says
   * so, because ambient mode cannot work until that changes.
   */
  it("turns ambient on for the chat and warns when Group Privacy hides messages", async () => {
    const h = harness({
      bindings: { [CHAT]: "agent-1" },
      readsGroupMessages: false,
    });
    const thread = makeThread({ id: `${CHAT}:99` });
    await h.handle(thread, { text: "/ambient on", author: author() }, true);
    expect(h.setAmbient).toHaveBeenCalledWith(CHAT, true);
    const posted = thread.posts.join("\n");
    expect(posted).toContain("Ambient mode turned on");
    expect(posted).toContain("Group Privacy");
  });

  it("does nothing when ambient mode is already in the asked state", async () => {
    const h = harness({ bindings: { [CHAT]: "agent-1" } });
    const thread = makeThread({ id: CHAT });
    await h.handle(thread, { text: "/ambient off", author: author() }, true);
    expect(thread.posts.join("\n")).toContain("Ambient mode is already off.");
    expect(h.setAmbient).not.toHaveBeenCalled();
  });

  it("explains that a direct chat has no ambient mode", async () => {
    const h = harness({ boundTo: "agent-1" });
    const dm = makeThread({ isDM: true });
    await h.handle(dm, { text: "/ambient on", author: author() }, true);
    expect(dm.posts.join("\n")).toContain("every message reaches the agent");
    expect(h.setAmbient).not.toHaveBeenCalled();
  });
});
