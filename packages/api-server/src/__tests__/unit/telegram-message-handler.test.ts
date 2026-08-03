import { createInspectableTtlStore } from "../helpers/ttl-store.js";
import { describe, it, expect, vi } from "vitest";
import { configureLogger } from "../../core/logger.js";
import {
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

function makeThread(opts?: { isDM?: boolean }) {
  const posts: string[] = [];
  const thread: ThreadLike & { posts: string[]; subscribed: boolean } = {
    id: "chat-42",
    isDM: opts?.isDM ?? false,
    posts,
    subscribed: false,
    async post(message) {
      posts.push(
        typeof message === "string" ? message : JSON.stringify(message),
      );
    },
    async subscribe() {
      thread.subscribed = true;
    },
  };
  return thread;
}

function harness(opts?: {
  boundTo?: string | null;
  isAdmin?: boolean;
  termsAccepted?: boolean;
}) {
  const { store: pendingOAuthFlows, map: pendingOAuthFlowsMap } =
    createInspectableTtlStore<TelegramOAuthPending>();
  const unbind = vi.fn(async () => {});
  const bind = vi.fn(async () => "bound" as const);
  const relay = vi.fn(async () => {});

  const handle = createTelegramMessageHandler({
    conversations: {
      findAgentByConversation: async () =>
        opts?.boundTo
          ? { agentId: opts.boundTo, authorizedBy: "kc|owner-1" }
          : null,
      bind,
      listByAgent: async () => [],
      unbind,
    },
    isChatAdmin: async () => opts?.isAdmin ?? true,
    decodeChatId: (threadId) => threadId,
    fetchChatTitle: async () => "Team chat",
    oauthConfig,
    pendingOAuthFlows,
    isTermsAccepted: async () => opts?.termsAccepted ?? true,
    uiBaseUrl: "https://app.example",
    brandShort: "dam",
    relay,
  });

  return {
    handle,
    pendingOAuthFlows,
    pendingOAuthFlowsMap,
    unbind,
    bind,
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
  it("denies `/dam bind` from a non-admin in a group", async () => {
    const h = harness({ isAdmin: false });
    const thread = makeThread();
    await h.handle(thread, { text: "/dam bind", author: author() }, true);
    expect(thread.posts.join("\n")).toContain(
      "Only group admins can `/dam bind`.",
    );
    expect(h.pendingOAuthFlowsMap.size).toBe(0);
  });

  it("tells an already-bound chat to unbind first", async () => {
    const h = harness({ boundTo: "agent-1" });
    const thread = makeThread();
    await h.handle(thread, { text: "/dam bind", author: author() }, true);
    expect(thread.posts.join("\n")).toContain("`/dam unbind` first");
    expect(h.pendingOAuthFlowsMap.size).toBe(0);
  });

  it("mints a pending OAuth flow (no agent, with chat title) and posts the link", async () => {
    const h = harness();
    const thread = makeThread({ isDM: true });
    await h.handle(thread, { text: "/dam bind", author: author() }, true);

    expect(h.pendingOAuthFlowsMap.size).toBe(1);
    const pending = [...h.pendingOAuthFlowsMap.values()][0]!;
    expect(pending).toMatchObject({
      telegramUserId: "tg-7",
      threadId: "chat-42",
      chatTitle: "Team chat",
    });
    // The bind link posts as a card: text + an inline URL button, so the
    // raw OAuth URL never shows in the chat.
    const posted = thread.posts.join("\n");
    expect(posted).toContain("Connect this chat to one of your agents");
    expect(posted).toContain("link-button");
    expect(posted).toContain("https://kc.example");
  });

  it("unbinds on `/dam unbind` from a bound chat", async () => {
    const h = harness({ boundTo: "agent-1" });
    const thread = makeThread();
    await h.handle(thread, { text: "/dam unbind", author: author() }, true);
    expect(h.unbind).toHaveBeenCalledWith("chat-42");
    expect(thread.posts.join("\n")).toContain("Chat disconnected");
  });

  it("shows usage for a bare `/dam` (or `/dam@bot`) with no subcommand", async () => {
    const h = harness();
    // Explicitly invoking the command answers on any surface — a DM, and (like
    // a bind/unbind deny) an unbound group; a non-admin still gets the help.
    for (const isDM of [true, false]) {
      for (const text of ["/dam", "/dam@dam_bot", "/dam help"]) {
        const thread = makeThread({ isDM });
        await h.handle(thread, { text, author: author() }, true);
        const posted = thread.posts.join("\n");
        expect(posted).toContain("/dam bind");
        expect(posted).toContain("/dam unbind");
      }
    }
    // Usage is help only — it neither starts a bind flow nor unbinds.
    expect(h.pendingOAuthFlowsMap.size).toBe(0);
    expect(h.unbind).not.toHaveBeenCalled();
  });

  it("no longer treats `/login` or `/logout` as commands", async () => {
    // `/login` is now ordinary text: no bind flow starts, and an unbound DM
    // just gets the not-connected prompt.
    const loginH = harness();
    const dm = makeThread({ isDM: true });
    await loginH.handle(dm, { text: "/login", author: author() }, true);
    expect(loginH.pendingOAuthFlowsMap.size).toBe(0);
    expect(dm.posts.join("\n")).toContain("isn't connected to an agent");

    // `/logout` in a bound chat no longer unbinds — it relays as a message.
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

  it("relays a bound chat's message to the bound agent and subscribes", async () => {
    const h = harness({ boundTo: "agent-1" });
    const thread = makeThread();
    await h.handle(thread, { text: "hello agent", author: author() }, true);
    expect(thread.subscribed).toBe(true);
    expect(h.relay).toHaveBeenCalledWith(
      "agent-1",
      thread,
      "hello agent",
      expect.objectContaining({ userId: "tg-7" }),
    );
  });

  it("treats /start (bare or deep-linked) as bind intent", async () => {
    const h = harness();
    for (const text of ["/start", "/start login", "/start@dam_bot login"]) {
      const dm = makeThread({ isDM: true });
      await h.handle(dm, { text, author: author() }, true);
      expect(dm.posts.join("\n")).toContain(
        "Connect this chat to one of your agents",
      );
    }
    expect(h.pendingOAuthFlowsMap.size).toBe(3);
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
});
