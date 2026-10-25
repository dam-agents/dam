import { describe, it, expect } from "vitest";
import {
  createSessionMetadata,
  createWorld,
  frames,
  type World,
} from "./acp-world.js";

/**
 * TEST_OVERVIEW: who sent each prompt and who answered each tool call.
 *
 * The owner and the Agent Editors of a Shared Agent work in the same
 * Sessions. The api-server's relay writes the signed-in person into every
 * prompt frame (`_meta.platform.sender`) and every permission answer
 * (`result._meta.platform.answeredBy`). The runtime keeps a Sender per prompt,
 * the Session Starter and each tool call's verdict in session metadata,
 * returns them on load, and tells engaged viewers live. The harness never sees
 * these stamps. A prompt the platform made carries no Sender.
 */

const SESSION = "sess-shared";
const OWNER = { sub: "owner-sub", email: "owner@example.com" };
const EDITOR = { sub: "editor-sub", email: "editor@example.com" };

function personPrompt(
  id: number,
  text: string,
  promptId: string,
  sender: { sub: string; email: string },
) {
  return {
    jsonrpc: "2.0",
    id,
    method: "session/prompt",
    params: {
      sessionId: SESSION,
      prompt: [{ type: "text", text }],
      _meta: { platform: { promptId, surface: "ui", sender } },
    },
  };
}

function startSession(world: World) {
  const machine = world.connect({ viewer: false });
  machine.send(frames.newSession(1));
  world.harness().replyTo("session/new", { sessionId: SESSION });
  return machine;
}

function loadedPlatformMeta(world: World): Record<string, unknown> {
  const viewer = world.connect();
  viewer.send(frames.loadSession(90, SESSION));
  const reply = viewer.reply(90) as {
    result?: { _meta?: { platform?: Record<string, unknown> } };
  };
  return reply.result?._meta?.platform ?? {};
}

describe("acp-runtime: senders and verdicts", () => {
  /**
   * TEST_SCENARIO: The owner sends a prompt and an editor watches. The
   * harness gets the prompt without the stamp. The editor hears who sent it
   * and whose turn runs, and a load returns the same Sender and the running
   * turn's Sender, so a reload shows the same names.
   */
  it("should record the Sender of a prompt and name the running turn", () => {
    const meta = createSessionMetadata();
    const world = createWorld({ sessionMetadata: meta.store });
    startSession(world);
    const editor = world.connect();
    editor.send(frames.loadSession(2, SESSION));

    const owner = world.connect();
    owner.send(personPrompt(3, "fix the build", "p-owner", OWNER));

    const forwarded = world.harness().received("session/prompt")[0];
    expect(JSON.stringify(forwarded)).not.toContain("owner-sub");
    expect(editor.saw("platform/senderRecorded")[0]?.params).toMatchObject({
      sessionId: SESSION,
      entry: { promptId: "p-owner", sender: OWNER },
    });
    expect(editor.saw("platform/turnStarted")[0]?.params).toEqual({
      sessionId: SESSION,
      sender: OWNER,
    });
    const loaded = loadedPlatformMeta(world);
    expect(loaded.senders).toMatchObject([
      { promptId: "p-owner", sender: OWNER },
    ]);
    expect(loaded.turn).toMatchObject({ inFlight: true, sender: OWNER });
    expect(meta.store.get(SESSION)?.starter).toEqual(OWNER);
  });

  /**
   * TEST_SCENARIO: A prompt with no stamp, as a scheduled fire sends, records
   * no Sender. Its turn starts with no Sender, so nobody reads "Working for"
   * a person, and the Session has no Session Starter.
   */
  it("should record no Sender for a prompt the platform made", () => {
    const meta = createSessionMetadata();
    const world = createWorld({ sessionMetadata: meta.store });
    const machine = startSession(world);
    const viewer = world.connect();
    viewer.send(frames.loadSession(2, SESSION));

    machine.send(frames.prompt(3, SESSION, "nightly triage"));

    expect(viewer.saw("platform/senderRecorded")).toEqual([]);
    expect(viewer.saw("platform/turnStarted")[0]?.params).toEqual({
      sessionId: SESSION,
    });
    expect(meta.store.get(SESSION)?.starter).toBeUndefined();
  });

  /**
   * TEST_SCENARIO: The owner's prompt waits in the queue behind a running
   * turn and an editor edits it. The queue names the owner first and the
   * editor after the edit, because editing a prompt makes the person who
   * edited it its Sender.
   */
  it("should make the person who edits a queued prompt its Sender", () => {
    const world = createWorld({
      sessionMetadata: createSessionMetadata().store,
    });
    startSession(world);
    const owner = world.connect();
    owner.send(personPrompt(2, "first", "p-1", OWNER));
    owner.send(personPrompt(3, "second", "p-2", OWNER));
    const queued = owner.saw("platform/queueChanged").at(-1)?.params as {
      items: { sender?: unknown }[];
    };
    expect(queued.items[0]?.sender).toEqual(OWNER);

    const editor = world.connect();
    editor.send({
      jsonrpc: "2.0",
      id: 4,
      method: "platform/updateQueued",
      params: {
        sessionId: SESSION,
        promptId: "p-2",
        prompt: [{ type: "text", text: "second, but smaller" }],
        _meta: { platform: { sender: EDITOR } },
      },
    });

    const edited = owner.saw("platform/queueChanged").at(-1)?.params as {
      items: { sender?: unknown }[];
    };
    expect(edited.items[0]?.sender).toEqual(EDITOR);
  });

  /**
   * TEST_SCENARIO: An editor allows a tool call once. The harness gets the
   * answer without the stamp. The owner hears the verdict and who gave it,
   * and a load returns it keyed by the harness's tool call id.
   */
  it("should record who answered a tool call", () => {
    const meta = createSessionMetadata();
    const world = createWorld({ sessionMetadata: meta.store });
    startSession(world);
    const owner = world.connect();
    owner.send(frames.loadSession(2, SESSION));
    const editor = world.connect();
    editor.send(frames.loadSession(3, SESSION));
    world.harness().emit(frames.requestPermission(7, SESSION));

    editor.send({
      jsonrpc: "2.0",
      id: 7,
      result: {
        outcome: { outcome: "selected", optionId: "allow" },
        _meta: { platform: { answeredBy: EDITOR } },
      },
    });

    expect(world.harness().answersTo(7)).toEqual([
      {
        jsonrpc: "2.0",
        id: 7,
        result: { outcome: { outcome: "selected", optionId: "allow" } },
      },
    ]);
    const verdict = { toolCallId: "tc-7", kind: "allow_once", by: EDITOR };
    expect(owner.saw("platform/verdictRecorded")[0]?.params).toEqual({
      sessionId: SESSION,
      verdict,
    });
    expect(loadedPlatformMeta(world).verdicts).toEqual([verdict]);
  });
});
