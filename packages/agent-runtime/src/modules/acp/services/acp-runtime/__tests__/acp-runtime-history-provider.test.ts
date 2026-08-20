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

describe("acp-runtime: session-history provider", () => {
  /**
   * TEST_SCENARIO: A cold load with a working provider must be served entirely
   * from the provider's output — capped tail, clipped marker with cursor,
   * synthesized response — and the harness must never be asked to load.
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
    bob.send(frames.loadSession(1, SESSION));
    await settle();

    expect(calls).toEqual([SESSION]);
    expect(world.harness().received("session/load")).toEqual([]);
    expect(replayedTexts(bob)).toEqual([
      "platform_clipped_replay",
      "m4",
      "m5",
      "m6",
    ]);
    expect(bob.reply(1)).toMatchObject({
      result: { sessionId: SESSION, modes: null },
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
