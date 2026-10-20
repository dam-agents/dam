/**
 * TEST_OVERVIEW: A session that picks no mode starts on the mode the catalog
 * defaults to for the session's model, so a Claude Code chat session starts in
 * auto like the terminal, and one on a model that cannot use auto starts on
 * the mode that model allows. A mode the session or the agent's file names
 * always wins, and a mode derived this way follows a model switch, since the
 * new model may not allow it. The harness reporting the derived mode back does
 * not turn it into a mode the session picked.
 */
import type { HarnessConfigCatalog } from "agent-runtime-api";
import { describe, expect, it } from "vitest";
import {
  derivedMode,
  modeSettingOf,
  sessionSettingFrames,
  type SessionHarness,
} from "../../modules/acp/services/session-setting-frames.js";
import {
  createSessionMetadata,
  createWorld,
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
  sessionSettings: { mode: { mode: true } },
  configured: () => ({ mode: configuredMode, model: configuredModel }),
});

const bobHarness = (env: Record<string, string>): SessionHarness => ({
  catalog: {
    options: [
      {
        id: "mode",
        name: "Mode",
        category: "mode",
        default: "agent",
        choices: [
          { value: "agent", name: "Agent" },
          { value: "plan", name: "Plan" },
        ],
      },
    ],
  },
  sessionSettings: { mode: { mode: true, startModeEnv: "BOB_CHAT_MODE" } },
  configured: () => ({ mode: null, model: null }),
  env,
});

const modeFrame = (frames: { method: string; params: unknown }[]) =>
  frames.find((frame) => frame.method === "session/set_mode");

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
    expect(modeFrame(frames({ mode: "plan" }, "ibm/claude-opus-4-5"))).toEqual({
      method: "session/set_mode",
      params: { sessionId: "s", modeId: "plan" },
    });
  });

  /** TEST_SCENARIO: The agent's config file names a mode, which its harness
   * reads at start: the runtime sends nothing, so a saved mode such as
   * "acceptEdits" is not replaced by the catalog's default. */
  it("leaves a mode the agent's file names to the harness", () => {
    expect(
      modeFrame(frames({}, "ibm/claude-opus-4-5", harness("acceptEdits"))),
    ).toBeUndefined();
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
    const frames = sessionSettingFrames({
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
    expect(frames).toEqual([
      {
        method: "session/set_config_option",
        params: { sessionId: "s", configId: "effortLevel", value: "high" },
      },
    ]);
  });

  it("names the setting the mode hangs on", () => {
    expect(modeSettingOf(harness())).toEqual({ id: "mode" });
    expect(modeSettingOf(undefined)).toBeUndefined();
  });

  /** TEST_SCENARIO: The harness reads a start mode from an env variable its
   * manifest binds, as Bob reads a connection's pinned mode: the pinned mode
   * is the session's start, so the runtime sends none and the pin stays. */
  it("leaves a start mode the harness's env names to the harness", () => {
    const input = {
      sessionId: "s",
      settings: {},
      model: "ibm/claude-opus-4-5",
      native: false,
      harness: bobHarness({ BOB_CHAT_MODE: "plan" }),
    };
    expect(sessionSettingFrames(input)).toEqual([]);
    expect(derivedMode(input)).toBe(null);
  });

  /** TEST_SCENARIO: The same variable is empty, as an agent with no pin has
   * it: the harness starts on nothing it read, so the catalog's default
   * applies. */
  it("derives the catalog default where the env variable is empty", () => {
    expect(
      modeFrame(
        sessionSettingFrames({
          sessionId: "s",
          settings: {},
          model: null,
          native: false,
          harness: bobHarness({}),
        }),
      )?.params,
    ).toEqual({ sessionId: "s", modeId: "agent" });
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
    derivedModeOf: (sessionId) => derivedMode(input(sessionId)),
  });
  return { world, metadata };
}

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

describe("session start mode on the wire", () => {
  /** TEST_SCENARIO: An unset session reaches its harness in auto when the
   * harness reports that mode back, the session has still picked none, so a
   * switch to a model that cannot use auto derives the mode again. */
  it("derives the mode again when the model changes", () => {
    const { world, metadata } = runtimeWorld();
    const client = world.connect();
    client.send(newSession(1, { model: "ibm/claude-opus-4-5" }));
    world.harness().replyTo("session/new", { sessionId: "s" });
    const harness = world.harness();
    expect(modesSent(harness)).toEqual(["auto"]);
    world.runtime.syncSessionSettings("s");
    harness.emit(reportMode("auto"));
    expect(metadata.store.get("s")?.meta.settings).toBeUndefined();

    metadata.store.set("s", {
      ...metadata.store.get("s")!.meta,
      model: "ibm/claude-haiku-4-5",
    });
    world.runtime.syncSessionSettings("s");
    expect(modesSent(harness)).toEqual(["auto", "default"]);
  });

  /** TEST_SCENARIO: The session is torn down and its harness reports the
   * derived mode: the runtime recomputes the mode it derives, so the report is
   * still no pick of the session's and a model switch derives again. */
  it("recognizes the derived mode after a teardown", () => {
    const { world, metadata } = runtimeWorld();
    const client = world.connect();
    client.send(newSession(1, { model: "ibm/claude-opus-4-5" }));
    world.harness().replyTo("session/new", { sessionId: "s" });
    world.runtime.resetSession("s");
    world.harness().emit(reportMode("auto"));
    expect(metadata.store.get("s")?.meta.settings).toBeUndefined();
  });

  /** TEST_SCENARIO: A mode the harness adopts on its own belongs to the
   * session, so a later model switch leaves it alone. */
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
    expect(modesSent(harness)).toEqual(["plan"]);
    harness.emit(reportMode("plan"));
    expect(metadata.store.get("s")?.meta.settings).toEqual({ mode: "plan" });

    metadata.store.set("s", {
      ...metadata.store.get("s")!.meta,
      model: "ibm/claude-haiku-4-5",
    });
    world.runtime.syncSessionSettings("s");
    expect(modesSent(harness)).toEqual(["plan"]);
  });

  /** TEST_SCENARIO: A mode the harness switches to on its own, beside the one
   * the runtime derived, is the session's from then on. */
  it("keeps a mode the harness switched to beside a derived one", () => {
    const { world, metadata } = runtimeWorld();
    const client = world.connect();
    client.send(newSession(1, { model: "ibm/claude-opus-4-5" }));
    world.harness().replyTo("session/new", { sessionId: "s" });
    world.harness().emit(reportMode("plan"));
    expect(metadata.store.get("s")?.meta.settings).toEqual({ mode: "plan" });
  });
});
