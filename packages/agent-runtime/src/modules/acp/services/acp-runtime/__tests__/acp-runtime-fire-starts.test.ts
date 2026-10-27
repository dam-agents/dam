import { afterEach, describe, expect, it, vi } from "vitest";

import { createSessionMetadataStore } from "../../../infrastructure/session-metadata-store.js";
import { createTriggerSessionDriver } from "../../trigger-session-driver.js";
import {
  createInMemoryUndeliveredStore,
  createWorld,
  memoryDocumentBackend,
  promptTextsOf,
} from "./acp-world.js";

/**
 * TEST_OVERVIEW: a fire opens a fresh Session through the Trigger Session
 * Driver, and its event settles once the driver returns. So the driver must
 * not return before the runtime has taken the fire's prompt into a turn: a
 * prompt that is refused, or never reaches the runtime, after the driver hung
 * up is answered to nobody. The fire then reads delivered, no turn ever ran,
 * and the Session is left unstored and empty, retired the first time someone
 * opens it. Here the start fails instead, so the fire's event is delivered
 * again, and the empty Session it opened is retired at once.
 */

const MODEL = "ibm/aws/claude-opus-5-5";
const FIRE_META = {
  type: "schedule_once",
  mode: "chat",
  scheduleId: "sched-1",
  fireEvent: "trigger:sched-1:1",
};

function fireWorld() {
  const metadata = createSessionMetadataStore(memoryDocumentBackend());
  const undeliveredPrompts = createInMemoryUndeliveredStore();
  const world = createWorld({
    sessionMetadata: metadata,
    undeliveredPrompts,
    sessionSettingFrames: (sessionId) => [
      {
        method: "session/set_config_option",
        params: { sessionId, configId: "model", value: MODEL },
        critical: true,
      },
    ],
  });
  const driver = createTriggerSessionDriver({
    acpRuntime: world.runtime,
    modelRequired: () => false,
    modelMissing: () => false,
    sessionMetadata: metadata,
  });
  const fire = () =>
    driver
      .start({
        task: "Append the date to ~/qa-sched.txt",
        platformMeta: FIRE_META,
      })
      .then(
        () => "settled" as const,
        (err: Error) => err,
      );
  return { world, metadata, undeliveredPrompts, fire };
}

describe("acp-runtime: a fire's fresh session", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * TEST_SCENARIO: the staging loss on a woken agent. The harness was spawned
   * before the model catalog listed, so it refuses the session's model twice,
   * and the runtime answers the queued prompt with that refusal. The fire
   * must not settle as delivered on a prompt no turn took, and no empty
   * unstored Session may stay behind to vanish when it is opened.
   */
  it("fails the start when the harness refuses the session's model", async () => {
    vi.useFakeTimers();
    const { world, metadata, undeliveredPrompts, fire } = fireWorld();
    const outcome = fire();
    await vi.waitFor(() => world.harness().replyTo("initialize"));
    await vi.waitFor(() =>
      world.harness().replyTo("session/new", { sessionId: "s-fire" }),
    );
    const refuse = () =>
      world.harness().refuseTo("session/set_config_option", {
        code: -32602,
        message: "Invalid params",
        data: { details: `unknown model "${MODEL}"` },
      });
    refuse();
    vi.advanceTimersByTime(2_500);
    refuse();

    const failed = await outcome;
    expect(failed).toBeInstanceOf(Error);
    expect((failed as Error).message).toContain("refused the session's model");
    expect(promptTextsOf(world.harness())).toEqual([]);
    await vi.waitFor(() => expect(metadata.isTombstoned("s-fire")).toBe(true));
    expect(undeliveredPrompts.readFor("s-fire")).toEqual([]);
  });

  /**
   * TEST_SCENARIO: an env recycle is owed while the fire's session/new is in
   * flight, so it waits for that call, and runs the moment its answer has
   * been handled: before the driver can send the prompt. The recycle closes
   * the driver's connection, and a prompt sent on it reaches nothing.
   */
  it("fails the start when the harness is recycled before the prompt is sent", async () => {
    const metadata = createSessionMetadataStore(memoryDocumentBackend());
    const world = createWorld({ sessionMetadata: metadata });
    const driver = createTriggerSessionDriver({
      acpRuntime: world.runtime,
      modelRequired: () => false,
      modelMissing: () => false,
      sessionMetadata: metadata,
    });
    const outcome = driver.start({ task: "due", platformMeta: FIRE_META }).then(
      () => "settled" as const,
      (err: Error) => err,
    );
    await vi.waitFor(() => world.harness().replyTo("initialize"));
    await vi.waitFor(() =>
      expect(world.harness().received("session/new")).toHaveLength(1),
    );
    world.runtime.refreshEnv({ force: false });
    world.harness().replyTo("session/new", { sessionId: "s-fire" });

    expect(await outcome).toBeInstanceOf(Error);
    expect(world.harness().killed()).toBe(true);
    expect(promptTextsOf(world.harness())).toEqual([]);
    expect(metadata.isTombstoned("s-fire")).toBe(true);
  });

  /**
   * TEST_SCENARIO: the start returns once the harness took the prompt into
   * a turn, which is after the session's model was set; the fire settles on
   * a turn that runs.
   */
  it("returns once the prompt's turn has started", async () => {
    const { world, fire } = fireWorld();
    const outcome = fire();
    await vi.waitFor(() => world.harness().replyTo("initialize"));
    await vi.waitFor(() =>
      world.harness().replyTo("session/new", { sessionId: "s-fire" }),
    );
    await vi.waitFor(() =>
      world.harness().replyTo("session/set_config_option"),
    );

    expect(await outcome).toBe("settled");
    expect(promptTextsOf(world.harness())).toEqual([
      "Append the date to ~/qa-sched.txt",
    ]);
  });
});
