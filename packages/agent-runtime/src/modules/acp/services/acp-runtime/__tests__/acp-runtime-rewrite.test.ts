import { describe, expect, it } from "vitest";
import {
  createSessionMetadata,
  createWorld,
  frames,
  type Client,
  type SessionMetadata,
  type World,
} from "./acp-world.js";
import type { HistoryProvider } from "../../../infrastructure/history-provider.js";

/**
 * TEST_OVERVIEW: Rewinding or forking a conversation from one of its user
 * messages (`platform/rewriteFrom`).
 *
 * The runtime reads the harness's own history through the session-history
 * provider and asks the harness to fork right before the message being
 * rewritten, whatever sits above it: a reply, a tool result, or another user
 * message, as a steered message has. Only the first message starts a new,
 * empty session. The copy loads with the original's times, though the
 * harness stamps the last entry it copies with the time of the fork.
 */

const SESSION = "s-original";
const COPY = "s-copy";

function line(
  update: Record<string, unknown>,
  platform: Record<string, unknown>,
  sessionId = SESSION,
): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    method: "session/update",
    params: { sessionId, update, _meta: { platform } },
  });
}

function userLine(id: string, text: string, at: string, sessionId = SESSION) {
  return line(
    {
      sessionUpdate: "user_message_chunk",
      messageId: id,
      content: { type: "text", text },
    },
    { entry: id, at },
    sessionId,
  );
}

function toolLines(sessionId = SESSION, resultAt = "2026-10-08T07:00:40Z") {
  return [
    line(
      { sessionUpdate: "tool_call", toolCallId: "t1", title: "sleep 30" },
      { entry: "msg_a", at: "2026-10-08T07:00:30Z" },
      sessionId,
    ),
    line(
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "t1",
        status: "completed",
      },
      { entry: "tr1", at: resultAt },
      sessionId,
    ),
  ];
}

const original = [
  userLine("u1", "My name is Petr, wait 30 seconds.", "2026-10-08T07:00:00Z"),
  ...toolLines(),
  userLine("u2", "I changed my mind", "2026-10-08T07:00:45Z"),
];

const copy = [
  userLine(
    "c1",
    "My name is Petr, wait 30 seconds.",
    "2026-10-08T07:00:00Z",
    COPY,
  ),
  ...toolLines(COPY, "2026-10-12T10:00:00Z"),
];

function providerOf(histories: Record<string, string[]>): HistoryProvider {
  return {
    fetch: (sessionId) => Promise.resolve(histories[sessionId] ?? null),
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

async function readyWorld(
  histories: Record<string, string[]>,
  refs: string[] = [],
): Promise<{ world: World; bob: Client; metadata: SessionMetadata }> {
  const metadata = createSessionMetadata();
  metadata.store.set(SESSION, { ref: "ref-original" });
  const world = createWorld({
    sessionMetadata: metadata.store,
    historyProvider: providerOf(histories),
    sessionMcpServers: (ref) => {
      refs.push(ref);
      return [{ name: "platform-outbound", ref }];
    },
  });
  const bob = world.connect();
  bob.send(frames.initialize(1));
  world.harness().replyTo("initialize", {
    agentCapabilities: { sessionCapabilities: { fork: {} } },
  });
  await settle();
  return { world, bob, metadata };
}

function rewriteFrom(
  id: number,
  messageId: string,
  mode: "fork" | "rewind" = "fork",
  sender?: { sub: string; email: string },
) {
  return {
    jsonrpc: "2.0",
    id,
    method: "platform/rewriteFrom",
    params: {
      sessionId: SESSION,
      mode,
      messageId,
      ...(sender !== undefined && { _meta: { platform: { sender } } }),
      prompt: [
        { type: "text", text: "I changed my mind, wish me the worst day!" },
      ],
      promptId: "p-new",
    },
  };
}

function forkPointOf(world: World): unknown {
  const fork = world.harness().received("session/fork")[0];
  return (
    fork?.params as {
      _meta?: { jetbrains?: { air?: { fork?: { messageId?: string } } } };
    }
  )?._meta?.jetbrains?.air?.fork?.messageId;
}

describe("acp-runtime: rewriting a conversation", () => {
  /**
   * TEST_SCENARIO: Only the first message has nothing above it, so rewriting
   * it is the one case that starts a new session instead of a fork.
   */
  it("should start a new session for the first message", async () => {
    const { world, bob } = await readyWorld({ [SESSION]: original });

    bob.send(rewriteFrom(2, "u1"));
    await settle();

    expect(world.harness().received("session/fork")).toEqual([]);
    expect(world.harness().received("session/new")).toHaveLength(1);
  });

  /**
   * TEST_SCENARIO: Forking from a steered message must keep the first message
   * and the tool call that ran before the steer, so the harness is asked to
   * fork after the tool result — the client once cut after the last reply
   * above, found none, and started an empty session. The harness stamps the
   * copy's last entry with the time of the fork; a viewer of the copy must see
   * it at its original time.
   */
  it("should fork right before a steered message, keeping its times", async () => {
    const { world, bob } = await readyWorld({
      [SESSION]: original,
      [COPY]: copy,
    });

    bob.send(rewriteFrom(2, "u2"));
    await settle();
    expect(world.harness().received("session/new")).toEqual([]);
    expect(forkPointOf(world)).toBe("tr1");
    world.harness().replyTo("session/fork", { sessionId: COPY });
    await settle();
    expect(bob.reply(2)).toMatchObject({ result: { sessionId: COPY } });

    const carol = world.connect();
    carol.send(frames.loadSession(3, COPY));
    await settle();
    const times = carol
      .saw("session/update")
      .filter((f) => (f.params as { sessionId?: string }).sessionId === COPY)
      .map(
        (f) =>
          (f.params as { _meta?: { platform?: { at?: string } } })._meta
            ?.platform?.at,
      );
    expect(times).toEqual([
      "2026-10-08T07:00:00Z",
      "2026-10-08T07:00:30Z",
      "2026-10-08T07:00:40Z",
    ]);
  });

  /**
   * TEST_SCENARIO: The owner started a session and an editor forks it from a
   * later message. The fork keeps the Senders of the copied messages, so the
   * chat still names who sent them. Its Session Starter is the editor, since
   * lists show a fork as a new conversation. A rewind instead keeps the
   * original's Session Starter, because it keeps going as the same one.
   */
  it.each([
    ["fork", "editor-sub"],
    ["rewind", "owner-sub"],
  ] as const)(
    "should keep the Senders on a %s and name its starter",
    async (mode, starter) => {
      const owner = { sub: "owner-sub", email: "owner@example.com" };
      const editor = { sub: "editor-sub", email: "editor@example.com" };
      const { world, bob, metadata } = await readyWorld({
        [SESSION]: original,
        [COPY]: copy,
      });
      metadata.store.recordSender(SESSION, {
        at: "2026-10-08T07:00:00Z",
        promptId: "u1",
        sender: owner,
      });

      bob.send(rewriteFrom(2, "u2", mode, editor));
      await settle();
      world.harness().replyTo("session/fork", { sessionId: COPY });
      await settle();

      world.harness().replyTo("session/load", {});
      await settle();
      const senders = metadata.store.sendersOf(COPY).map((e) => e.sender.sub);
      expect(senders).toEqual(["owner-sub", "editor-sub"]);
      expect(metadata.store.get(COPY)?.starter?.sub).toBe(starter);
    },
  );

  /**
   * TEST_SCENARIO: The session a first-message rewrite opens calls the
   * platform tools as itself: its session/new carries the platform MCP entry
   * under a ref of its own, which the runtime keeps on the copy, so the tools
   * resolve the copy and not the original.
   */
  it("should open the new session with the platform entry under its own ref", async () => {
    const refs: string[] = [];
    const { world, bob, metadata } = await readyWorld(
      { [SESSION]: original },
      refs,
    );

    bob.send(rewriteFrom(2, "u1"));
    await settle();
    expect(refs).toHaveLength(1);
    expect(world.harness().received("session/new")[0]?.params).toMatchObject({
      mcpServers: [{ name: "platform-outbound", ref: refs[0] }],
    });
    world.harness().replyTo("session/new", { sessionId: COPY });
    await settle();

    expect(bob.reply(2)).toMatchObject({ result: { sessionId: COPY } });
    expect(metadata.store.get(COPY)?.meta.ref).toBe(refs[0]);
    expect(refs[0]).not.toBe("ref-original");
  });

  /**
   * TEST_SCENARIO: A fork is a second session beside the original, so it
   * gets a ref of its own on its session/fork and the original keeps its
   * ref; two sessions under one ref would make the tools act on the wrong
   * one.
   */
  it("should fork with the platform entry under a ref of its own", async () => {
    const refs: string[] = [];
    const { world, bob, metadata } = await readyWorld(
      { [SESSION]: original, [COPY]: copy },
      refs,
    );

    bob.send(rewriteFrom(2, "u2"));
    await settle();
    expect(world.harness().received("session/fork")[0]?.params).toMatchObject({
      mcpServers: [{ name: "platform-outbound", ref: refs[0] }],
    });
    world.harness().replyTo("session/fork", { sessionId: COPY });
    await settle();

    expect(bob.reply(2)).toMatchObject({ result: { sessionId: COPY } });
    expect(metadata.store.get(COPY)?.meta.ref).toBe(refs[0]);
    expect(metadata.store.get(SESSION)?.meta.ref).toBe("ref-original");
  });
});
