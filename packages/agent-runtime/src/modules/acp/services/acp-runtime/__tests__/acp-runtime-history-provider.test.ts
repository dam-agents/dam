import { describe, it, expect } from "vitest";
import { createWorld, frames, type Client, type Frame } from "./acp-world.js";
import type { HistoryProvider } from "../../../infrastructure/history-provider.js";

/**
 * TEST_OVERVIEW: cold session fills from the image's session-history provider
 * instead of the harness.
 *
 * When the runtime-manifest declares a sessionHistory command, a cold
 * session/load runs it and fills the Session Transcript from its output — no
 * harness process is involved and the response is synthesized with
 * placeholder metadata. The harness has then never loaded the session, so the
 * first session/prompt triggers one silent harness session/load first (its
 * replay is dropped — the transcript already holds the history) and the
 * prompt is forwarded only after the harness answers, which also upgrades the
 * cached metadata to the harness's real answer. A provider failure falls back
 * to the harness load, and a provider-served session that goes idle sends no
 * session/close, because the harness holds nothing to close.
 */

const SESSION = "sess-provider";

function updateLine(text: string): string {
  return JSON.stringify(frames.agentMessage(SESSION, text));
}

function providerOf(
  result: string[] | null,
  calls: string[] = [],
): HistoryProvider {
  return {
    fetch(sessionId) {
      calls.push(sessionId);
      return Promise.resolve(result);
    },
  };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function replayedTexts(client: Client): (string | undefined)[] {
  return client.saw("session/update").map((frame) => {
    const params = frame.params as {
      update?: { sessionUpdate?: string; content?: { text?: string } };
    };
    return params.update?.content?.text ?? params.update?.sessionUpdate;
  });
}

function loadTail(id: number, sessionId: string): Frame {
  return {
    jsonrpc: "2.0",
    id,
    method: "session/load",
    params: {
      sessionId,
      cwd: ".",
      mcpServers: [],
      _meta: { platform: { tail: true } },
    },
  };
}

describe("acp-runtime: session-history provider", () => {
  /**
   * TEST_SCENARIO: A cold load with a working provider must be served entirely
   * from the provider's output — capped tail for an opted-in viewer, cursor
   * on the synthesized response — and the harness must never be asked to
   * load.
   */
  it("should serve a cold load from the provider without a harness load", async () => {
    const calls: string[] = [];
    const world = createWorld({
      replayTailEvents: 3,
      historyProvider: providerOf(
        ["m1", "m2", "m3", "m4", "m5", "m6"].map(updateLine),
        calls,
      ),
    });

    const bob = world.connect();
    bob.send(loadTail(1, SESSION));
    await settle();

    expect(calls).toEqual([SESSION]);
    expect(world.harness().received("session/load")).toEqual([]);
    expect(replayedTexts(bob)).toEqual(["m4", "m5", "m6"]);
    expect(bob.reply(1)).toMatchObject({
      result: {
        sessionId: SESSION,
        modes: null,
        _meta: { platform: { clipped: { older: expect.any(String) } } },
      },
    });
  });

  /**
   * TEST_SCENARIO: The provider is an accelerator, never an authority: when
   * it fails (null), the cold load must fall back to the harness path and
   * behave exactly as if no provider existed.
   */
  it("should fall back to the harness load when the provider fails", async () => {
    const world = createWorld({
      replayTailEvents: 3,
      historyProvider: providerOf(null),
    });

    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));
    await settle();

    expect(world.harness().received("session/load")).toHaveLength(1);
    world.harness().emit(frames.agentMessage(SESSION, "m1"));
    world
      .harness()
      .replyToSession("session/load", SESSION, { sessionId: SESSION });
    expect(replayedTexts(bob)).toEqual(["m1"]);
    expect(bob.reply(1)).toMatchObject({ result: { sessionId: SESSION } });
  });

  /**
   * TEST_SCENARIO: The harness never loaded a provider-served session, so the
   * first prompt must first rehydrate it with a silent harness load — whose
   * replay must not reach the viewer or duplicate the transcript — and only
   * then forward the prompt. The harness's load answer also upgrades the
   * cached metadata, so later loads carry real modes instead of the
   * placeholder.
   */
  it("should rehydrate the harness before the first prompt, without duplicating history", async () => {
    const world = createWorld({
      replayTailEvents: 10,
      historyProvider: providerOf(["m1", "m2"].map(updateLine)),
    });

    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));
    await settle();

    bob.send(frames.prompt(2, SESSION, "hello there"));
    expect(world.harness().received("session/prompt")).toEqual([]);
    expect(world.harness().received("session/load")).toHaveLength(1);

    world.harness().emit(frames.agentMessage(SESSION, "m1"));
    world.harness().emit(frames.agentMessage(SESSION, "m2"));
    world.harness().replyToSession("session/load", SESSION, {
      sessionId: SESSION,
      modes: { currentModeId: "auto" },
    });

    expect(world.harness().received("session/prompt")).toHaveLength(1);

    const carol = world.connect();
    carol.send(frames.loadSession(1, SESSION));
    expect(replayedTexts(carol)).toEqual(["m1", "m2", "hello there"]);
    expect(carol.reply(1)).toMatchObject({
      result: { sessionId: SESSION, modes: { currentModeId: "auto" } },
    });
  });

  /**
   * TEST_SCENARIO: Several prompts can arrive while the rehydrate is in
   * flight; all of them must be held and forwarded in arrival order once the
   * harness has the session, and none may be dropped or duplicated.
   */
  it("should hold every prompt during rehydrate and release them in order", async () => {
    const world = createWorld({
      historyProvider: providerOf(["m1"].map(updateLine)),
    });

    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));
    await settle();

    bob.send(frames.prompt(2, SESSION, "first"));
    bob.send(frames.prompt(3, SESSION, "second"));
    expect(world.harness().received("session/prompt")).toEqual([]);

    world
      .harness()
      .replyToSession("session/load", SESSION, { sessionId: SESSION });

    const promptTexts = (): (string | undefined)[] =>
      (world.harness().received("session/prompt") as Frame[]).map((f) => {
        const params = f.params as { prompt?: { text?: string }[] };
        return params.prompt?.[0]?.text;
      });

    expect(promptTexts()).toEqual(["first"]);
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });
    expect(promptTexts()).toEqual(["first", "second"]);
  });

  /**
   * TEST_SCENARIO: The harness refuses the rehydrate load. The held prompt
   * must fail with the harness's error instead of being forwarded to a
   * harness that never loaded the session — and the session must stay cold,
   * so a later prompt retries the rehydrate and can succeed.
   */
  it("should fail held prompts on a rehydrate error and retry on the next prompt", async () => {
    const world = createWorld({
      historyProvider: providerOf(["m1"].map(updateLine)),
    });

    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));
    await settle();

    bob.send(frames.prompt(2, SESSION, "first try"));
    const loadId = world.harness().received("session/load")[0]!.id;
    world.harness().emit({
      jsonrpc: "2.0",
      id: loadId,
      error: { code: -32000, message: "store unreadable" },
    });

    expect(world.harness().received("session/prompt")).toEqual([]);
    expect(bob.reply(2)).toMatchObject({
      error: { code: -32000, message: "store unreadable" },
    });

    bob.send(frames.prompt(3, SESSION, "second try"));
    expect(world.harness().received("session/load")).toHaveLength(2);
    const retryId = world.harness().received("session/load")[1]!.id;
    world
      .harness()
      .emit({ jsonrpc: "2.0", id: retryId, result: { sessionId: SESSION } });
    expect(world.harness().received("session/prompt")).toHaveLength(1);
  });

  /**
   * TEST_SCENARIO: The harness never answers the rehydrate load at all — it
   * hangs or the frame is lost. The held prompt must fail with a timeout
   * error instead of waiting forever, and the unresponsive harness must be
   * recycled rather than asked to load the same session twice: the viewer is
   * engaged here, so a second load's replay reclassified as live would
   * duplicate the whole conversation in an open window.
   */
  it("should time out a hanging rehydrate, fail held prompts, and recycle the harness", async () => {
    const world = createWorld({
      historyProvider: providerOf(["m1"].map(updateLine)),
      harnessLoadTimeoutMs: 1,
    });
    const bob = world.connect();
    const wedged = world.harness();
    bob.send(frames.loadSession(1, SESSION));
    await settle();

    bob.send(frames.prompt(2, SESSION, "into the void"));
    expect(wedged.received("session/load")).toHaveLength(1);
    await settle();

    expect(bob.reply(2)).toMatchObject({ error: { code: -32000 } });
    expect(wedged.received("session/prompt")).toEqual([]);
    expect(wedged.received("session/load")).toHaveLength(1);
    expect(wedged.killed()).toBe(true);
  });

  /**
   * TEST_SCENARIO: An abandoned rehydrate load answers late while a viewer
   * is still engaged. Its replay is history the transcript already holds, so
   * reclassifying it as live would show the reader their own conversation a
   * second time. It must stay suppressed.
   */
  it("should suppress an abandoned rehydrate's late replay for an engaged viewer", async () => {
    const world = createWorld({
      historyProvider: providerOf(["m1", "m2"].map(updateLine)),
      harnessLoadTimeoutMs: 1,
    });
    const bob = world.connect();
    const wedged = world.harness();
    bob.send(frames.loadSession(1, SESSION));
    await settle();
    expect(replayedTexts(bob)).toEqual(["m1", "m2"]);

    bob.send(frames.prompt(2, SESSION, "hello"));
    await settle();
    expect(bob.reply(2)).toMatchObject({ error: { code: -32000 } });

    wedged.emit(frames.agentMessage(SESSION, "m1"));
    wedged.emit(frames.agentMessage(SESSION, "m2"));

    expect(replayedTexts(bob)).toEqual(["m1", "m2"]);
  });

  /**
   * TEST_SCENARIO: The provider itself can hang. The cold fill's one
   * deadline spans the provider attempt and any harness fallback, so a
   * provider that never resolves must fail the waiters with a timeout error
   * — without the harness ever being asked, since the fallback never
   * started.
   */
  it("should time out a cold fill when the provider hangs", async () => {
    const world = createWorld({
      harnessLoadTimeoutMs: 1,
      historyProvider: {
        fetch: () => new Promise<string[] | null>(() => {}),
      },
    });

    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));
    await settle();

    expect(bob.reply(1)).toMatchObject({ error: { code: -32000 } });
    expect(world.harness().received("session/load")).toEqual([]);
  });

  /**
   * TEST_SCENARIO: The recycle that follows an unanswered load waits for
   * in-flight work, so on a busy pod the abandoned load outlives its
   * timeout. A later request for that session must still be servable — the
   * provider needs no harness — and must not send a second harness load,
   * because the two loads' replays would be indistinguishable. The
   * abandoned load's own late frames stay suppressed even after the
   * provider has filled the transcript.
   */
  it("should serve a retry from the provider while an abandoned load is outstanding", async () => {
    let fetches = 0;
    const world = createWorld({
      replayTailEvents: 10,
      harnessLoadTimeoutMs: 1,
      historyProvider: {
        fetch() {
          fetches += 1;
          return Promise.resolve(
            fetches === 1 ? null : ["m1", "m2"].map(updateLine),
          );
        },
      },
    });

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: "sess-busy" });
    alice.send(frames.prompt(2, "sess-busy", "long running"));

    const bob = world.connect();
    bob.send(loadTail(1, SESSION));
    await settle();

    const abandoned = world
      .harness()
      .received("session/load")
      .find(
        (f) => (f.params as { sessionId?: string }).sessionId === SESSION,
      )!.id;
    expect(bob.reply(1)).toMatchObject({ error: { code: -32000 } });
    expect(world.harness().killed()).toBe(false);

    bob.send(loadTail(2, SESSION));
    await settle();

    expect(bob.reply(2)).toMatchObject({ result: { sessionId: SESSION } });
    expect(replayedTexts(bob)).toEqual(["m1", "m2"]);
    expect(
      world
        .harness()
        .received("session/load")
        .filter(
          (f) => (f.params as { sessionId?: string }).sessionId === SESSION,
        ),
    ).toHaveLength(1);

    world.harness().emit(frames.agentMessage(SESSION, "m1"));
    world.harness().emit({
      jsonrpc: "2.0",
      id: abandoned,
      result: { sessionId: SESSION, modes: null },
    });
    expect(replayedTexts(bob)).toEqual(["m1", "m2"]);
  });

  /**
   * TEST_SCENARIO: Idle reaping frees the harness's per-session subprocess —
   * but a provider-served session has none. Reaping it must not send
   * session/close for a session the harness never loaded.
   */
  it("should not send session/close when reaping a provider-served session", async () => {
    const world = createWorld({
      idleReapDelayMs: 0,
      historyProvider: providerOf(["m1"].map(updateLine)),
    });

    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));
    await settle();

    bob.disconnect();
    await settle();

    expect(world.harness().received("session/close")).toEqual([]);
  });
});
