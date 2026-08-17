import { describe, it, expect } from "vitest";
import { createWorld, frames, promptTextsOf } from "./acp-world.js";

/**
 * TEST_OVERVIEW: prompt delivery feedback.
 *
 * A session runs one prompt at a time. If a client sends session/prompt
 * while another prompt is still running, the runtime puts the new prompt
 * in a queue and forwards it to the harness when the running one finishes.
 * The queue holds at most 32 prompts; the next one is rejected with an
 * error response whose data.code is PROMPT_QUEUE_FULL.
 *
 * A client can put a promptId into the prompt's _meta.platform field. The
 * runtime then tells that client what happened to the prompt, as
 * notifications sent only to that client: platform/promptAccepted (with
 * queued: true or false) when the runtime takes it, platform/promptStarted
 * when it is forwarded to the harness. A prompt without a promptId gets no
 * notifications and works exactly as before.
 */

const SESSION = "sess-delivery";

function promptWithId(
  id: number,
  sessionId: string,
  text: string,
  promptId: string,
): object {
  return {
    jsonrpc: "2.0",
    id,
    method: "session/prompt",
    params: {
      sessionId,
      prompt: [{ type: "text", text }],
      _meta: { platform: { promptId } },
    },
  };
}

describe("acp-runtime: prompt delivery", () => {
  /**
   * TEST_SCENARIO: A prompt with a promptId arrives on a session with nothing
   * running. The client must get promptAccepted (queued: false) and then
   * promptStarted. The harness must receive the prompt without the
   * _meta.platform block — the promptId is between client and runtime, the
   * harness should never see it.
   */
  it("should tell the sender its prompt was accepted and started when the session is free", () => {
    const world = createWorld();

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(promptWithId(2, SESSION, "lint the repo", "p-1"));

    expect(alice.saw("platform/promptAccepted").map((f) => f.params)).toEqual([
      { sessionId: SESSION, promptId: "p-1", queued: false },
    ]);
    expect(alice.saw("platform/promptStarted").map((f) => f.params)).toEqual([
      { sessionId: SESSION, promptId: "p-1" },
    ]);

    const [prompt] = world.harness().received("session/prompt");
    expect(prompt.params).not.toHaveProperty("_meta");
  });

  /**
   * TEST_SCENARIO: A second prompt arrives while the first is still running.
   * The client must get promptAccepted (queued: true) right away — without
   * it, a queued prompt looks lost, because it produces nothing for as long
   * as the first one runs. promptStarted must come only after the harness
   * answers the first prompt and the runtime forwards the second.
   */
  it("should report queued at once and started only when the turn ahead ends", () => {
    const world = createWorld();

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(promptWithId(2, SESSION, "first task", "p-1"));
    alice.send(promptWithId(3, SESSION, "second task", "p-2"));

    expect(alice.saw("platform/promptAccepted").map((f) => f.params)).toEqual([
      { sessionId: SESSION, promptId: "p-1", queued: false },
      { sessionId: SESSION, promptId: "p-2", queued: true },
    ]);
    expect(alice.saw("platform/promptStarted").map((f) => f.params)).toEqual([
      { sessionId: SESSION, promptId: "p-1" },
    ]);

    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    expect(alice.saw("platform/promptStarted").map((f) => f.params)).toEqual([
      { sessionId: SESSION, promptId: "p-1" },
      { sessionId: SESSION, promptId: "p-2" },
    ]);
    expect(promptTextsOf(world.harness())).toEqual([
      "first task",
      "second task",
    ]);
  });

  /**
   * TEST_SCENARIO: The notifications describe one client's send, not the
   * conversation. So they go only to the client that sent the prompt, and
   * they are not written to the transcript. Another client attached at the
   * time must not get them, and a client that loads the session later must
   * not get them replayed.
   */
  it("should tell only the sender, and never replay the notifications", () => {
    const world = createWorld();

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));

    alice.send(promptWithId(2, SESSION, "audit the deps", "p-1"));
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    expect(bob.saw("platform/promptAccepted")).toEqual([]);
    expect(bob.saw("platform/promptStarted")).toEqual([]);

    const carol = world.connect();
    carol.send(frames.loadSession(1, SESSION));
    expect(carol.saw("platform/promptAccepted")).toEqual([]);
    expect(carol.saw("platform/promptStarted")).toEqual([]);
  });

  /**
   * TEST_SCENARIO: A prompt without a promptId — sent by the CLI, a channel
   * worker, or an older client. It must behave exactly as before the
   * notifications existed: the prompt runs and gets its response, and no
   * platform/* notification is sent to a client that never asked for one.
   */
  it("should stay silent for a sender that mints no promptId", () => {
    const world = createWorld();

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(frames.prompt(2, SESSION, "plain prompt"));
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    expect(alice.saw("platform/promptAccepted")).toEqual([]);
    expect(alice.saw("platform/promptStarted")).toEqual([]);
    expect(alice.reply(2)?.result).toEqual({ stopReason: "end_turn" });
  });

  /**
   * TEST_SCENARIO: One prompt is running and 32 are queued — the queue is
   * full. The next prompt must be rejected with an error response whose
   * data.code is PROMPT_QUEUE_FULL, so the client can tell a full queue
   * from other errors. The rejection must not damage anything: the 33
   * accepted prompts still run, in order, and the rejected one never
   * reaches the harness.
   */
  it("should refuse the prompt past the cap and still run everything queued", () => {
    const world = createWorld();

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });

    alice.send(frames.prompt(100, SESSION, "task 0"));
    for (let i = 1; i <= 32; i++) {
      alice.send(frames.prompt(100 + i, SESSION, `task ${i}`));
    }
    alice.send(frames.prompt(200, SESSION, "one too many"));

    const refusal = alice.reply(200);
    expect(refusal?.error).toMatchObject({
      code: -32000,
      data: { code: "PROMPT_QUEUE_FULL" },
    });
    expect((refusal?.error as { message: string }).message).toContain(SESSION);

    for (let i = 0; i <= 32; i++) {
      world.harness().replyTo("session/prompt", { stopReason: "end_turn" });
    }
    const texts = promptTextsOf(world.harness());
    expect(texts).toHaveLength(33);
    expect(texts[0]).toBe("task 0");
    expect(texts[32]).toBe("task 32");
    expect(texts).not.toContain("one too many");
    expect(alice.reply(132)?.result).toEqual({ stopReason: "end_turn" });
  });
});
