/**
 * TEST_OVERVIEW: A session that picks no mode starts on the mode the catalog
 * defaults to for the session's model, so a Claude Code chat session starts in
 * auto like the terminal, and one on a model that cannot use auto starts on
 * the mode that model allows. Only a harness whose manifest opts in gets that
 * mode: one with start modes of its own, such as Pi's thinking levels or Bob's
 * pinned persona, is left on them. A mode the session names always wins, and
 * one the agent's file names never does (tool approval is a session's own
 * pick), and a derived mode follows a model switch, since the new model
 * may not allow it. The mode is sent after the model's own answer, on every
 * path that sends it and after a model the harness refused is asked for again.
 * A mode the harness reports is the runtime's own while a mode-bearing setting
 * the runtime sent still awaits its answer, so an echo or a fallback a model
 * change forced is not saved as the session's; while only queued work waits, or
 * a client sent the setting, the report is the session's and is saved, and a
 * derived mode still queued behind the turn is dropped.
 */
import type { HarnessConfigCatalog } from "agent-runtime-api";
import { describe, expect, it, vi } from "vitest";
import {
  derivedMode,
  modeSettingOf,
  sessionSettingFrames,
  type SessionHarness,
} from "../../modules/acp/services/session-setting-frames.js";
import {
  createSessionMetadata,
  createWorld,
  frames as wire,
  type Harness,
} from "../../modules/acp/services/acp-runtime/__tests__/acp-world.js";

const CATALOG: HarnessConfigCatalog = {
  options: [
    {
      id: "model",
      name: "Model",
      category: "model",
      choices: [],
    },
    {
      id: "mode",
      name: "Mode",
      category: "mode",
      default: "auto",
      choices: [
        { value: "auto", name: "Auto" },
        { value: "default", name: "Ask for approvals" },
        { value: "plan", name: "Plan mode" },
        { value: "dontAsk", name: "Don't ask" },
      ],
    },
  ],
  modelConstraints: {
    haiku: { mode: ["default", "plan", "dontAsk"] },
  },
};

const harness = (
  configuredMode: string | null = null,
  configuredModel: string | null = null,
): SessionHarness => ({
  catalog: CATALOG,
  sessionModelFrame: { configOption: "model", render: (model) => model },
  sessionSettings: { mode: { mode: true, deriveStartMode: true } },
  configured: () => ({ mode: configuredMode, model: configuredModel }),
});

const ownStartModeHarness = (): SessionHarness => ({
  catalog: {
    options: [
      {
        id: "mode",
        name: "Thinking",
        category: "mode",
        default: "medium",
        choices: [
          { value: "off", name: "Off" },
          { value: "medium", name: "Medium" },
          { value: "high", name: "High" },
        ],
      },
    ],
  },
  sessionSettings: { mode: { mode: true } },
  configured: () => ({ mode: null, model: null }),
});

const modeFrame = (sent: { method: string; params: unknown }[]) =>
  sent.find((frame) => frame.method === "session/set_mode");

const frames = (
  settings: Record<string, string>,
  model: string | null,
  forHarness: SessionHarness = harness(),
) =>
  sessionSettingFrames({
    sessionId: "s",
    settings,
    model,
    native: false,
    harness: forHarness,
  });

describe("session start mode", () => {
  /** TEST_SCENARIO: The owner or session picked nothing and the model takes
   * auto: the session starts in auto, as the terminal launcher does, and the
   * frame says the runtime derived it. */
  it("starts an unset session in auto on a model that allows it", () => {
    expect(modeFrame(frames({}, "ibm/claude-opus-4-5"))).toEqual({
      method: "session/set_mode",
      params: { sessionId: "s", modeId: "auto" },
    });
  });

  /** TEST_SCENARIO: The catalog excludes auto for the session's model: the
   * session starts on the first mode that model allows rather than in a mode
   * the catalog refuses. */
  it("starts an unset session on the first mode the model allows", () => {
    expect(modeFrame(frames({}, "ibm/claude-haiku-4-5"))).toEqual({
      method: "session/set_mode",
      params: { sessionId: "s", modeId: "default" },
    });
  });

  /** TEST_SCENARIO: The session names no model, so it runs on the model the
   * agent's config file names: a file naming a model the catalog refuses auto
   * for gives the session a mode that model allows, not auto. */
  it("derives from the model the agent's file names when the session names none", () => {
    expect(modeFrame(frames({}, null, harness(null, "haiku")))?.params).toEqual(
      {
        sessionId: "s",
        modeId: "default",
      },
    );
  });

  /** TEST_SCENARIO: A mode the session picked is the session's, whatever the
   * model: it is sent as it is and never marked derived, so a model switch
   * leaves it alone. */
  it("sends a mode the session picked as it is", () => {
    expect(
      modeFrame(frames({ mode: "plan" }, "ibm/claude-opus-4-5")),
    ).toStrictEqual({
      method: "session/set_mode",
      params: { sessionId: "s", modeId: "plan" },
    });
  });

  /** TEST_SCENARIO: The agent's config file names a mode from before tool approval left it; the session still starts on the catalog's default, since only the session picks its approval. */
  it("starts on the catalog's mode whatever the agent's file names", () => {
    expect(
      modeFrame(frames({}, "ibm/claude-opus-4-5", harness("acceptEdits"))),
    ).toEqual({
      method: "session/set_mode",
      params: { sessionId: "s", modeId: "auto" },
    });
  });

  /** TEST_SCENARIO: The session's model changes mid-session: the derived mode
   * is derived again for the new model, and a picked mode is not. */
  it("derives the mode again when the model changes", () => {
    expect(modeFrame(frames({}, "ibm/claude-opus-4-5"))?.params).toEqual({
      sessionId: "s",
      modeId: "auto",
    });
    expect(modeFrame(frames({}, "ibm/claude-haiku-4-5"))?.params).toEqual({
      sessionId: "s",
      modeId: "default",
    });
    expect(
      modeFrame(frames({ mode: "auto" }, "ibm/claude-haiku-4-5")),
    ).toStrictEqual({
      method: "session/set_mode",
      params: { sessionId: "s", modeId: "auto" },
    });
  });

  /** TEST_SCENARIO: A harness that binds no mode setting gets no mode frame,
   * and its other settings still reach it. */
  it("sends no mode frame for a harness that binds none", () => {
    const sent = sessionSettingFrames({
      sessionId: "s",
      settings: { effort: "high" },
      model: null,
      native: false,
      harness: {
        catalog: CATALOG,
        sessionSettings: { effort: { configOption: "effortLevel" } },
        configured: () => ({ mode: null, model: null }),
      },
    });
    expect(sent).toEqual([
      {
        method: "session/set_config_option",
        params: { sessionId: "s", configId: "effortLevel", value: "high" },
      },
    ]);
  });

  it("names the setting the mode hangs on and whether it opts in", () => {
    expect(modeSettingOf(harness())).toEqual({ id: "mode", derive: true });
    expect(modeSettingOf(ownStartModeHarness())).toEqual({
      id: "mode",
      derive: false,
    });
    expect(modeSettingOf(undefined)).toBeUndefined();
  });

  /** TEST_SCENARIO: Pi binds its ACP mode to a thinking level and has its own
   * precedence for it — the resumed session's level, a per-model level, then
   * the global default. Its manifest names none of that, so it does not opt
   * in, and an unset session gets no mode frame: the level Pi chose stands
   * instead of being replaced by the catalog's default. */
  it("leaves a harness with start modes of its own on them", () => {
    const input = {
      sessionId: "s",
      settings: {},
      model: "ibm/claude-opus-4-5",
      native: false,
      harness: ownStartModeHarness(),
    };
    expect(sessionSettingFrames(input)).toEqual([]);
    expect(derivedMode(input)).toBe(null);
  });
});

function runtimeWorld() {
  const metadata = createSessionMetadata();
  const input = (sessionId: string) => ({
    sessionId,
    settings: metadata.store.get(sessionId)?.meta.settings ?? {},
    model: metadata.store.get(sessionId)?.meta.model ?? null,
    native: false,
    harness: harness(),
  });
  const world = createWorld({
    sessionMetadata: metadata.store,
    modeSettingId: "mode",
    sessionSettingFrames: (sessionId) => sessionSettingFrames(input(sessionId)),
    modelSettingConfig: "model",
  });
  return { world, metadata };
}

const CRITICAL_RETRY_MS = 2_000;

const modesSent = (harness: Harness): unknown[] =>
  harness
    .received("session/set_mode")
    .map((frame) => (frame.params as { modeId: string }).modeId);

const newSession = (id: number, platform: Record<string, unknown>) => ({
  jsonrpc: "2.0",
  id,
  method: "session/new",
  params: { cwd: ".", _meta: { platform } },
});

const reportMode = (mode: string) => ({
  jsonrpc: "2.0",
  method: "session/update",
  params: {
    sessionId: "s",
    update: { sessionUpdate: "current_mode_update", currentModeId: mode },
  },
});

const modelFramesSent = (harness: Harness): number =>
  harness
    .received("session/set_config_option")
    .filter(
      (sent) => (sent.params as { configId?: string }).configId === "model",
    ).length;

const answerModelFrame = (harness: Harness): void => {
  const frame = harness
    .received("session/set_config_option")
    .filter(
      (sent) => (sent.params as { configId?: string }).configId === "model",
    )
    .at(-1);
  if (frame === undefined) throw new Error("the model was never sent");
  harness.emit({ jsonrpc: "2.0", id: frame.id, result: {} });
};

const switchModel = (
  metadata: ReturnType<typeof createSessionMetadata>,
  world: { runtime: { syncSessionSettings: (id: string) => void } },
  harness: Harness,
): void => {
  metadata.store.set("s", {
    ...metadata.store.get("s")!.meta,
    model: "ibm/claude-haiku-4-5",
  });
  world.runtime.syncSessionSettings("s");
  answerModelFrame(harness);
};

describe("session start mode on the wire", () => {
  /** TEST_SCENARIO: A harness reads its mode against the model it holds, so
   * the runtime sends the model first and waits for its answer: the derived
   * mode reaches the harness only afterwards, never beside the model it was
   * not derived for, and the session's prompt waits for both. */
  it("sends the derived mode after the harness applied the model", () => {
    const { world } = runtimeWorld();
    const client = world.connect();
    client.send(newSession(1, { model: "ibm/claude-opus-4-5" }));
    const harness = world.harness();
    harness.replyTo("session/new", { sessionId: "s" });
    expect(modesSent(harness)).toEqual([]);

    client.send(wire.prompt(2, "s", "hello"));
    answerModelFrame(harness);
    expect(modesSent(harness)).toEqual(["auto"]);
    expect(harness.received("session/prompt")).toEqual([]);

    harness.replyTo("session/set_mode", {});
    expect(harness.received("session/prompt").length).toBe(1);
  });

  /** TEST_SCENARIO: An unset session reaches its harness in auto, the harness
   * reports that mode back, and the session has still picked none, so a
   * switch to a model that cannot use auto derives the mode again. */
  it("derives the mode again when the model changes", () => {
    const { world, metadata } = runtimeWorld();
    const client = world.connect();
    client.send(newSession(1, { model: "ibm/claude-opus-4-5" }));
    world.harness().replyTo("session/new", { sessionId: "s" });
    const harness = world.harness();
    answerModelFrame(harness);
    expect(modesSent(harness)).toEqual(["auto"]);
    harness.emit(reportMode("auto"));
    harness.replyTo("session/set_mode", {});
    expect(metadata.store.get("s")?.meta.settings).toBeUndefined();

    switchModel(metadata, world, harness);
    harness.emit(reportMode("default"));
    harness.replyTo("session/set_mode", {});
    expect(modesSent(harness)).toEqual(["auto", "default"]);
  });

  /** TEST_SCENARIO: The session is torn down and its harness reports the
   * derived mode: the runtime knows the mode it derived from the session's own
   * metadata, so the report is still no pick of the session's. */
  it("recognizes the derived mode after a teardown", () => {
    const { world, metadata } = runtimeWorld();
    const client = world.connect();
    client.send(newSession(1, { model: "ibm/claude-opus-4-5" }));
    world.harness().replyTo("session/new", { sessionId: "s" });
    answerModelFrame(world.harness());
    world.runtime.resetSession("s");
    world.runtime.syncSessionSettings("s");
    answerModelFrame(world.harness());
    world.harness().emit(reportMode("auto"));
    expect(metadata.store.get("s")?.meta.settings).toBeUndefined();
  });

  /** TEST_SCENARIO: The session moved to a model that cannot use auto while
   * the harness had not yet reported the auto it was sent: both echoes arrive
   * late, and neither becomes the session's own mode, so switching back to a
   * model that takes auto derives auto again. */
  it("keeps a late echo of an earlier model's mode out of the session", () => {
    const { world, metadata } = runtimeWorld();
    const client = world.connect();
    client.send(newSession(1, { model: "ibm/claude-opus-4-5" }));
    world.harness().replyTo("session/new", { sessionId: "s" });
    const harness = world.harness();
    answerModelFrame(harness);
    harness.replyTo("session/set_mode", {});
    switchModel(metadata, world, harness);

    harness.emit(reportMode("auto"));
    harness.emit(reportMode("default"));
    harness.replyTo("session/set_mode", {});
    expect(metadata.store.get("s")?.meta.settings).toBeUndefined();
    expect(modesSent(harness)).toEqual(["auto", "default"]);

    metadata.store.set("s", {
      ...metadata.store.get("s")!.meta,
      model: "ibm/claude-opus-4-5",
    });
    world.runtime.syncSessionSettings("s");
    answerModelFrame(harness);
    expect(modesSent(harness)).toEqual(["auto", "default", "auto"]);
  });

  /** TEST_SCENARIO: Another client connects to the session and prompts before
   * the model was answered, as a chat that reconnects does: the derived mode
   * still waits for the model, so it is never read against the model the
   * session is leaving. */
  it("keeps the derived mode back when another client engages the session", () => {
    const { world } = runtimeWorld();
    const client = world.connect();
    client.send(newSession(1, { model: "ibm/claude-opus-4-5" }));
    const harness = world.harness();
    harness.replyTo("session/new", { sessionId: "s" });

    const other = world.connect();
    other.send(wire.prompt(2, "s", "hello"));
    expect(modesSent(harness)).toEqual([]);

    answerModelFrame(harness);
    expect(modesSent(harness)).toEqual(["auto"]);
  });

  /** TEST_SCENARIO: The harness refuses the model because it has not listed
   * it, and the runtime asks again two seconds later: the retried model goes
   * out first and the mode follows it, never the other way round. */
  it("asks for a refused model again before the mode that depends on it", () => {
    vi.useFakeTimers();
    try {
      const { world } = runtimeWorld();
      const client = world.connect();
      client.send(newSession(1, { model: "ibm/claude-opus-4-5" }));
      world.harness().replyTo("session/new", { sessionId: "s" });
      const harness = world.harness();
      harness.refuseTo("session/set_config_option", {
        code: -32000,
        message: "unknown model",
      });
      expect(modesSent(harness)).toEqual([]);

      vi.advanceTimersByTime(CRITICAL_RETRY_MS);
      expect(modelFramesSent(harness)).toBe(2);
      expect(modesSent(harness)).toEqual([]);

      answerModelFrame(harness);
      expect(modesSent(harness)).toEqual(["auto"]);
    } finally {
      vi.useRealTimers();
    }
  });

  /** TEST_SCENARIO: The session moves to a model that cannot use auto, and the
   * harness answers the move by falling back to a mode of its own before it
   * confirms: that fallback is the runtime's doing, not the session's pick, so
   * the mode the new model allows is what runs and what a later switch reads. */
  it("keeps a fallback the harness made for the new model out of the session", () => {
    const { world, metadata } = runtimeWorld();
    const client = world.connect();
    client.send(newSession(1, { model: "ibm/claude-opus-4-5" }));
    world.harness().replyTo("session/new", { sessionId: "s" });
    const harness = world.harness();
    answerModelFrame(harness);
    harness.replyTo("session/set_mode", {});

    switchModel(metadata, world, harness);
    harness.emit(reportMode("acceptEdits"));
    expect(metadata.store.get("s")?.meta.settings).toBeUndefined();

    harness.replyTo("session/set_mode", {});
    expect(modesSent(harness)).toEqual(["auto", "default"]);

    metadata.store.set("s", {
      ...metadata.store.get("s")!.meta,
      model: "ibm/claude-opus-4-5",
    });
    world.runtime.syncSessionSettings("s");
    answerModelFrame(harness);
    expect(modesSent(harness)).toEqual(["auto", "default", "auto"]);
  });

  /** TEST_SCENARIO: The owner picks a mode, so the runtime stops deriving one,
   * and the harness then reports the mode the session moved to on its own — the
   * auto mode a plan exit lands in: that report is the session's and is saved,
   * so the runtime does not push the mode the owner left back on the next
   * prompt. */
  it("keeps a mode the harness reports after the session picked one", () => {
    const { world, metadata } = runtimeWorld();
    const client = world.connect();
    client.send(newSession(1, { model: "ibm/claude-opus-4-5" }));
    world.harness().replyTo("session/new", { sessionId: "s" });
    const harness = world.harness();
    answerModelFrame(harness);
    harness.replyTo("session/set_mode", {});

    metadata.store.set("s", {
      ...metadata.store.get("s")!.meta,
      settings: { mode: "plan" },
    });
    world.runtime.syncSessionSettings("s");
    harness.replyTo("session/set_mode", {});
    expect(modesSent(harness)).toEqual(["auto", "plan"]);

    harness.emit(reportMode("auto"));
    expect(metadata.store.get("s")?.meta.settings).toEqual({ mode: "auto" });
  });

  /** TEST_SCENARIO: The harness enters plan mode of its own accord, on a
   * session whose mode the runtime derives and whose settings have all been
   * answered: that report is the session's, so it is saved and the next prompt
   * does not put the derived mode back. */
  it("keeps a plan mode the harness entered while the runtime derives one", () => {
    const { world, metadata } = runtimeWorld();
    const client = world.connect();
    client.send(newSession(1, { model: "ibm/claude-opus-4-5" }));
    world.harness().replyTo("session/new", { sessionId: "s" });
    const harness = world.harness();
    answerModelFrame(harness);
    harness.replyTo("session/set_mode", {});

    harness.emit(reportMode("plan"));
    expect(metadata.store.get("s")?.meta.settings).toEqual({ mode: "plan" });

    client.send(wire.prompt(2, "s", "plan the change"));
    expect(modesSent(harness)).toEqual(["auto"]);
    expect(harness.received("session/prompt").length).toBe(1);
  });

  /** TEST_SCENARIO: The session's model is being switched when the owner picks
   * a mode: the mode the harness reconciles for the new model belongs to that
   * switch, not to the owner, so the picked mode stays what is saved. */
  it("keeps the mode the owner picked while the model switch settles", () => {
    const { world, metadata } = runtimeWorld();
    const client = world.connect();
    client.send(newSession(1, { model: "ibm/claude-opus-4-5" }));
    world.harness().replyTo("session/new", { sessionId: "s" });
    const harness = world.harness();
    answerModelFrame(harness);
    harness.replyTo("session/set_mode", {});

    metadata.store.set("s", {
      ...metadata.store.get("s")!.meta,
      settings: { mode: "plan" },
    });
    metadata.store.set("s", {
      ...metadata.store.get("s")!.meta,
      model: "ibm/claude-haiku-4-5",
    });
    world.runtime.syncSessionSettings("s");
    harness.emit(reportMode("acceptEdits"));
    expect(metadata.store.get("s")?.meta.settings).toEqual({ mode: "plan" });
    answerModelFrame(harness);
  });

  /** TEST_SCENARIO: The model is refused while a mode waits behind it: the
   * runtime asks for the model again as one block, in the order it lists it,
   * with no copy of the mode the block replaced left in the queue. */
  it("re-asks for a refused model once, in the listed order", () => {
    vi.useFakeTimers();
    try {
      const { world } = runtimeWorld();
      const client = world.connect();
      client.send(newSession(1, { model: "ibm/claude-opus-4-5" }));
      world.harness().replyTo("session/new", { sessionId: "s" });
      const harness = world.harness();
      harness.refuseTo("session/set_config_option", {
        code: -32000,
        message: "unknown model",
      });
      vi.advanceTimersByTime(CRITICAL_RETRY_MS);

      answerModelFrame(harness);
      expect(modesSent(harness)).toEqual(["auto"]);
      expect(modelFramesSent(harness)).toBe(2);

      harness.replyTo("session/set_mode", {});
      harness.replyTo("session/set_mode", {});
      expect(modesSent(harness)).toEqual(["auto"]);
      expect(modelFramesSent(harness)).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  /** TEST_SCENARIO: A client sends its own mode request while the refused model
   * waits to be asked for again: the retried model goes first, and the client's
   * request still reaches the harness and is answered. */
  it("keeps a client's own setting across a model retry", () => {
    vi.useFakeTimers();
    try {
      const { world } = runtimeWorld();
      const client = world.connect();
      client.send(newSession(1, { model: "ibm/claude-opus-4-5" }));
      world.harness().replyTo("session/new", { sessionId: "s" });
      const harness = world.harness();
      harness.refuseTo("session/set_config_option", {
        code: -32000,
        message: "unknown model",
      });

      client.send({
        jsonrpc: "2.0",
        id: 2,
        method: "session/set_mode",
        params: { sessionId: "s", modeId: "plan" },
      });
      vi.advanceTimersByTime(CRITICAL_RETRY_MS);
      expect(modelFramesSent(harness)).toBe(2);
      expect(modesSent(harness)).toEqual([]);

      answerModelFrame(harness);
      expect(modesSent(harness)).toEqual(["auto"]);
      harness.replyTo("session/set_mode", {});
      expect(modesSent(harness)).toEqual(["auto", "plan"]);
      harness.replyTo("session/set_mode", {});
      expect(client.reply(2)?.result).toEqual({});
    } finally {
      vi.useRealTimers();
    }
  });

  /** TEST_SCENARIO: The owner selects another model while a turn runs, and the
   * harness enters plan mode in that turn: the queued model change has not
   * reached the harness, so the plan the owner approved is the session's, and
   * neither the queued derived mode nor a re-derived one puts the derived mode
   * back afterwards. */
  it("keeps a plan mode the harness entered while a model change waits", () => {
    const { world, metadata } = runtimeWorld();
    const client = world.connect();
    client.send(newSession(1, { model: "ibm/claude-opus-4-5" }));
    world.harness().replyTo("session/new", { sessionId: "s" });
    const harness = world.harness();
    answerModelFrame(harness);
    harness.replyTo("session/set_mode", {});

    client.send(wire.prompt(2, "s", "plan the change"));
    metadata.store.set("s", {
      ...metadata.store.get("s")!.meta,
      model: "ibm/claude-haiku-4-5",
    });
    world.runtime.syncSessionSettings("s");
    expect(modelFramesSent(harness)).toBe(1);
    expect(modesSent(harness)).toEqual(["auto"]);

    harness.emit(reportMode("plan"));
    expect(metadata.store.get("s")?.meta.settings).toEqual({ mode: "plan" });

    harness.replyTo("session/prompt", { stopReason: "end_turn" });
    answerModelFrame(harness);
    expect(modelFramesSent(harness)).toBe(2);
    expect(modesSent(harness)).toEqual(["auto"]);

    client.send(wire.prompt(3, "s", "next"));
    expect(modesSent(harness)).toEqual(["auto", "plan"]);
    harness.replyTo("session/set_mode", {});
    expect(harness.received("session/prompt").length).toBe(2);
  });

  /** TEST_SCENARIO: A client sends its own mode request, as an ACP client of a
   * harness that does not opt in does: the mode the harness reports for it is
   * the session's choice, so it is saved and the next prompt does not put the
   * session's old mode back. */
  it("saves a mode a client picked beside a report", () => {
    const { world, metadata } = runtimeWorld();
    const client = world.connect();
    client.send(
      newSession(1, {
        model: "ibm/claude-opus-4-5",
        settings: { mode: "plan" },
      }),
    );
    world.harness().replyTo("session/new", { sessionId: "s" });
    const harness = world.harness();
    answerModelFrame(harness);
    harness.replyTo("session/set_mode", {});
    harness.emit(reportMode("plan"));

    client.send({
      jsonrpc: "2.0",
      id: 2,
      method: "session/set_mode",
      params: { sessionId: "s", modeId: "auto" },
    });
    harness.emit(reportMode("auto"));
    harness.replyTo("session/set_mode", {});
    expect(metadata.store.get("s")?.meta.settings).toEqual({ mode: "auto" });

    client.send(wire.prompt(3, "s", "next"));
    harness.replyTo("session/set_mode", {});
    expect(modesSent(harness)).toEqual(["plan", "auto"]);
  });

  /** TEST_SCENARIO: A client's own mode request and a platform choice overlap:
   * the platform's newer Plan waits behind the client's call, and the mode the
   * client's call reports is the older one, so it is neither saved over Plan nor
   * allowed to drop the queued Plan frame. */
  it("keeps a newer owner choice over an older client's report", () => {
    const { world, metadata } = runtimeWorld();
    const client = world.connect();
    client.send(newSession(1, { model: "ibm/claude-opus-4-5" }));
    world.harness().replyTo("session/new", { sessionId: "s" });
    const harness = world.harness();
    answerModelFrame(harness);
    harness.replyTo("session/set_mode", {});

    client.send({
      jsonrpc: "2.0",
      id: 2,
      method: "session/set_mode",
      params: { sessionId: "s", modeId: "default" },
    });
    metadata.store.set("s", {
      ...metadata.store.get("s")!.meta,
      settings: { mode: "plan" },
    });
    world.runtime.syncSessionSettings("s");

    harness.emit(reportMode("default"));
    harness.replyTo("session/set_mode", {});
    expect(metadata.store.get("s")?.meta.settings).toEqual({ mode: "plan" });

    client.send(wire.prompt(3, "s", "next"));
    expect(modesSent(harness)).toEqual(["auto", "default", "plan"]);
  });

  /** TEST_SCENARIO: A client switches the model itself, and the harness reports
   * the mode that switch forced: the fallback is the move's doing, not the
   * session's mode, so nothing is saved and the next model change derives
   * again. */
  it("keeps a client's model fallback out of the session", () => {
    const { world, metadata } = runtimeWorld();
    const client = world.connect();
    client.send(newSession(1, { model: "ibm/claude-opus-4-5" }));
    world.harness().replyTo("session/new", { sessionId: "s" });
    const harness = world.harness();
    answerModelFrame(harness);
    harness.replyTo("session/set_mode", {});

    client.send({
      jsonrpc: "2.0",
      id: 2,
      method: "session/set_config_option",
      params: {
        sessionId: "s",
        configId: "model",
        value: "ibm/claude-haiku-4-5",
      },
    });
    harness.emit(reportMode("acceptEdits"));
    harness.replyTo("session/set_config_option", {});
    expect(metadata.store.get("s")?.meta.settings).toBeUndefined();
  });

  /** TEST_SCENARIO: A derived mode is dropped because the session took another;
   * once the session ends, the process it ran in is free to be retired, so the
   * dropped frame leaves no answer owed to it. */
  it("releases the process after dropping a derived mode", () => {
    const { world, metadata } = runtimeWorld();
    const client = world.connect();
    client.send(newSession(1, { model: "ibm/claude-opus-4-5" }));
    world.harness().replyTo("session/new", { sessionId: "s" });
    const harness = world.harness();
    answerModelFrame(harness);
    harness.replyTo("session/set_mode", {});

    client.send(wire.prompt(2, "s", "plan the change"));
    metadata.store.set("s", {
      ...metadata.store.get("s")!.meta,
      model: "ibm/claude-haiku-4-5",
    });
    world.runtime.syncSessionSettings("s");
    harness.emit(reportMode("plan"));
    expect(metadata.store.get("s")?.meta.settings).toEqual({ mode: "plan" });

    harness.replyTo("session/prompt", { stopReason: "end_turn" });
    answerModelFrame(harness);
    client.send(wire.prompt(3, "s", "done"));
    harness.replyTo("session/set_mode", {});
    harness.replyTo("session/prompt", { stopReason: "end_turn" });
    world.runtime.releaseSession("s");
    client.disconnect();
    expect(world.runtime.holdsSessions()).toBe(false);
  });

  /** TEST_SCENARIO: A client picks Default while a derived Default waits behind
   * it for a model the owner switched to: the frames name the same mode but the
   * unsent one caused nothing, so the client's choice is saved, and a later
   * model change does not bring the derived mode back. */
  it("saves a client's choice that happens to match a queued derived mode", () => {
    const { world, metadata } = runtimeWorld();
    const client = world.connect();
    client.send(newSession(1, { model: "ibm/claude-opus-4-5" }));
    world.harness().replyTo("session/new", { sessionId: "s" });
    const harness = world.harness();
    answerModelFrame(harness);
    harness.replyTo("session/set_mode", {});

    client.send({
      jsonrpc: "2.0",
      id: 2,
      method: "session/set_config_option",
      params: { sessionId: "s", configId: "mode", value: "default" },
    });
    metadata.store.set("s", {
      ...metadata.store.get("s")!.meta,
      model: "ibm/claude-haiku-4-5",
    });
    world.runtime.syncSessionSettings("s");
    harness.emit(reportMode("default"));
    harness.replyTo("session/set_config_option", {});
    expect(metadata.store.get("s")?.meta.settings).toEqual({ mode: "default" });

    metadata.store.set("s", {
      ...metadata.store.get("s")!.meta,
      model: "ibm/claude-opus-4-5",
    });
    world.runtime.syncSessionSettings("s");
    harness.replyTo("session/set_mode", {});
    expect(modesSent(harness)).toEqual(["auto"]);
  });

  /** TEST_SCENARIO: A mode the session picked belongs to the session, so a
   * later model switch leaves it alone. */
  it("keeps a mode the session picked when the model changes", () => {
    const { world, metadata } = runtimeWorld();
    const client = world.connect();
    client.send(
      newSession(1, {
        model: "ibm/claude-opus-4-5",
        settings: { mode: "plan" },
      }),
    );
    world.harness().replyTo("session/new", { sessionId: "s" });
    const harness = world.harness();
    answerModelFrame(harness);
    harness.replyTo("session/set_mode", {});
    expect(modesSent(harness)).toEqual(["plan"]);
    harness.emit(reportMode("plan"));
    expect(metadata.store.get("s")?.meta.settings).toEqual({ mode: "plan" });

    switchModel(metadata, world, harness);
    harness.replyTo("session/set_mode", {});
    expect(modesSent(harness)).toEqual(["plan"]);
  });
});
