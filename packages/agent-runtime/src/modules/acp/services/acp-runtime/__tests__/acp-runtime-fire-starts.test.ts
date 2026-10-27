import { afterEach, describe, expect, it, vi } from "vitest";

import type { EventReportInput } from "agent-runtime-api";
import { createTriggerPlugin } from "../../../../runtime-channel/drivers/trigger-plugin.js";
import { createInvocationWatch } from "../../../../runtime-channel/services/invocation-watch.js";
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

type TurnOutcome = { stopReason: string | null; error: string | null };

function fireWorld(
  onTurnOutcome: (sessionId: string, end: TurnOutcome) => void = () => {},
) {
  const metadata = createSessionMetadataStore(memoryDocumentBackend());
  const undeliveredPrompts = createInMemoryUndeliveredStore();
  const world = createWorld({
    sessionMetadata: metadata,
    undeliveredPrompts,
    onTurnOutcome,
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
  return { world, metadata, undeliveredPrompts, driver, fire };
}

const refuseModel = (world: ReturnType<typeof createWorld>) =>
  world.harness().refuseTo("session/set_config_option", {
    code: -32602,
    message: "Invalid params",
    data: { details: `unknown model "${MODEL}"` },
  });

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
    refuseModel(world);
    vi.advanceTimersByTime(2_500);
    refuseModel(world);

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

  /**
   * TEST_SCENARIO: the harness answers none of the session's settings for
   * longer than the start waits, so the start returns with the prompt still
   * queued, and the refusal comes later. Nobody is left to hear it, so the
   * runtime writes the prompt down as undelivered and reports the turn's
   * failure with the refusal, which fails a one-time fire's schedule, instead
   * of leaving an empty session to vanish on its first open.
   */
  it("writes down a refusal that comes after the start gave up waiting", async () => {
    vi.useFakeTimers();
    const outcomes: [string, TurnOutcome][] = [];
    const { world, undeliveredPrompts, fire } = fireWorld((sessionId, end) =>
      outcomes.push([sessionId, end]),
    );
    const outcome = fire();
    await vi.waitFor(() => world.harness().replyTo("initialize"));
    await vi.waitFor(() =>
      world.harness().replyTo("session/new", { sessionId: "s-fire" }),
    );
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await outcome).toBe("settled");

    refuseModel(world);
    vi.advanceTimersByTime(2_500);
    refuseModel(world);

    expect(undeliveredPrompts.readFor("s-fire")).toHaveLength(1);
    expect(outcomes).toEqual([
      [
        "s-fire",
        {
          stopReason: null,
          error: expect.stringContaining("refused the session's model"),
        },
      ],
    ]);
  });

  /**
   * TEST_SCENARIO: a sub-agent's Invocation opens its session, and the
   * harness exits while the first prompt waits for the session's model. The
   * runtime drops the queue and reports the turn's failure at once, before the
   * start returns, so the Invocation's watch must already follow the session
   * or the sub-agent reads running until its deadline.
   */
  it("fails an Invocation whose harness exits before its first turn", async () => {
    const reports: EventReportInput[] = [];
    const watch = createInvocationWatch({
      reporter: { report: async (input) => void reports.push(input) },
      turnRunning: () => false,
      localWork: () => false,
      subAgentsRunning: async () => false,
      log: () => {},
    });
    const { world, driver } = fireWorld((sessionId, end) =>
      watch.turnOutcome(sessionId, end),
    );
    const trigger = createTriggerPlugin({
      driver,
      stateStore: {
        getSessionForSchedule: () => undefined,
        setSessionForSchedule: () => {},
        clearSessionForSchedule: () => {},
      },
      runPrecheck: async () => ({ verdict: "allowed" }),
      log: () => {},
      reporter: { report: async () => {} },
      invocationWatch: watch,
    }).bindEvent!("trigger", { impl: "trigger" });

    await trigger(
      {
        scheduleId: "invocation:a",
        task: "report a result",
        sessionMode: "fresh",
        invocation: true,
      },
      {
        eventId: "invocation:a:1",
        agentHome: "",
        pluginStateDir: "",
        log: () => {},
      },
    );
    await vi.waitFor(() => world.harness().replyTo("initialize"));
    await vi.waitFor(() =>
      world.harness().replyTo("session/new", { sessionId: "s-sub" }),
    );
    world.harness().exit();

    await vi.waitFor(() =>
      expect(reports).toEqual([
        {
          eventId: "invocation:a:1",
          outcome: "failed",
          stage: "run",
          detail: expect.stringContaining("the harness exited"),
        },
      ]),
    );
  });
});
