import { describe, it, expect } from "vitest";
import type { AgentsService } from "api-server-api";
import { configureLogger } from "../../core/logger.js";
import { createMemoryTtlStore } from "../../core/ttl-store.js";
import type { AcpClient, SendPromptOpts } from "../../core/acp-client.js";
import { createFakeSlackGateway } from "../../modules/channels/infrastructure/fake-slack-gateway.js";
import { createSlackWorker } from "../../modules/channels/infrastructure/slack.js";
import {
  EventType,
  type ChannelTurnRelayed,
  type DomainEvent,
} from "../../events.js";
import { stubTurnAttendance } from "../helpers/turn-attendance.js";
import { stubWorkspaceFiles } from "../helpers/workspace-files.js";

configureLogger({ level: "error", write: () => {} });

const OWNER = "kc|owner-1";
const ASKER = "U-ASKER";
const OWNER_SLACK = "U-OWNER";
const STRANGER = "U-STRANGER";
const MENTION_TS = "1.1";

const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * TEST_OVERVIEW: Slack's native Stop button on an agent's working status.
 * Slack sends agent_session_stopped for the thread when someone presses it.
 * The worker must cancel the running turn of that thread with ACP
 * session/cancel, the same path the web UI uses, but only for the person who
 * started the turn or the agent's owner. It must clear the status, end any
 * stream Slack named, and not hand the stopped turn to the delivery nudge, so
 * the agent is not prompted again to answer what the person stopped.
 */
function harness() {
  const gw = createFakeSlackGateway();
  const events: DomainEvent[] = [];
  const prompts: SendPromptOpts[] = [];
  const cancelled: string[] = [];
  let finishTurn: () => void = () => {};
  const acp: AcpClient = {
    steer: async () => "unsupported" as const,
    listSessions: async () => [],
    sendPrompt: async (_prompt, opts) => {
      prompts.push(opts);
      opts.onSession?.("s-1");
      await new Promise<void>((resolve) => {
        finishTurn = resolve;
        opts.signal?.addEventListener("abort", () => {
          cancelled.push("s-1");
          resolve();
        });
      });
      return "";
    },
    triggerSession: () => Promise.reject(new Error("unused")),
    turnStatus: async () => "ended" as const,
  };
  const worker = createSlackWorker({
    makeAcpClient: () => acp,
    createGateway: () => gw,
    agents: () =>
      ({
        ensureReady: async () => {},
        get: async () => ({ name: "Helper" }),
      }) as unknown as AgentsService,
    identityLinks: {
      resolve: async (_provider: string, slackUserId: string) =>
        slackUserId === OWNER_SLACK ? OWNER : null,
    } as never,
    oauthConfig: { authUrl: "http://kc", clientId: "c" } as never,
    pendingOAuthFlows: createMemoryTtlStore(600_000),
    getInstanceOwner: async () => OWNER,
    ownerDisplayName: async () => null,
    channelRegistry: {
      resolveSlackBindings: async () => [
        {
          instanceName: "agent-1",
          owner: OWNER,
          ambient: false,
          isDefault: true,
        },
      ],
      resolveSlackChannelsByInstance: async () => [{ id: "C1", teamId: "" }],
    } as never,
    unbindSlackChannel: async () => {},
    setSlackChannelAmbient: async () => {},
    agentsFor: () => ({}) as never,
    ignoredApps: {
      list: async () => [],
      ignore: async () => true,
      unignore: async () => true,
    },
    setSlackDefault: async () => true,
    brand: { name: "DAM", short: "dam" },
    isTermsAccepted: async () => true,
    uiBaseUrl: "http://ui",
    attendance: stubTurnAttendance(),
    workspaceFiles: stubWorkspaceFiles(),
    listWorkspaces: async () => [],
    emit: (e) => events.push(e),
    settleMs: 0,
    wakeWait: { sleep: async () => {} },
  });

  let turn: Promise<void> = Promise.resolve();
  return {
    gw,
    prompts,
    cancelled,
    async mention() {
      await worker.connect();
      turn = gw.fireMention({
        user: ASKER,
        channel: "C1",
        ts: MENTION_TS,
        text: "<@U-BOT> summarise the incident",
      });
      for (let i = 0; i < 200 && prompts.length === 0; i++) await tick();
    },
    async settle() {
      await turn;
      for (let i = 0; i < 20; i++) await tick();
    },
    finish() {
      finishTurn();
    },
    stop(user: string, streamingMessageTs: string[] = []) {
      return gw.fireSessionStopped({
        channel: "C1",
        threadTs: MENTION_TS,
        user,
        streamingMessageTs,
      });
    },
    ephemerals: () =>
      gw.readOutbound().filter((r) => r.kind === "ephemeral") as Array<{
        user: string;
        text: string;
      }>,
    turnEvents: () =>
      events.filter(
        (e): e is ChannelTurnRelayed => e.type === EventType.ChannelTurnRelayed,
      ),
  };
}

describe("the Slack Stop button", () => {
  /**
   * TEST_SCENARIO: The person who asked presses Stop while the agent works.
   * The turn's prompt is cancelled, the working status is cleared, the
   * person is told it stopped, and the turn is recorded as stopped. The
   * agent is not prompted a second time, because the delivery nudge would
   * otherwise ask it to answer the question the person just withdrew.
   */
  it("cancels the running turn when the person who asked presses it", async () => {
    const h = harness();
    await h.mention();

    await h.stop(ASKER);
    await h.settle();

    expect(h.cancelled).toEqual(["s-1"]);
    expect(h.prompts).toHaveLength(1);
    const statuses = h.gw.readOutbound().filter((r) => r.kind === "status");
    expect(statuses.at(-1)).toMatchObject({ status: "" });
    expect(h.ephemerals()).toEqual([
      expect.objectContaining({ user: ASKER, text: "Stopped `Helper`." }),
    ]);
    expect(h.turnEvents()).toEqual([
      expect.objectContaining({ outcome: "success", reason: "stopped" }),
    ]);
  });

  /**
   * TEST_SCENARIO: The agent's owner did not start the turn but may stop it,
   * because the agent and its spend are theirs. Their Slack account is linked
   * to the platform user who owns the agent.
   */
  it("lets the agent's owner stop a turn somebody else started", async () => {
    const h = harness();
    await h.mention();

    await h.stop(OWNER_SLACK);
    await h.settle();

    expect(h.cancelled).toEqual(["s-1"]);
    expect(h.ephemerals()).toEqual([
      expect.objectContaining({ user: OWNER_SLACK, text: "Stopped `Helper`." }),
    ]);
  });

  /**
   * TEST_SCENARIO: Anyone in the channel sees the Stop button. Somebody who
   * neither asked nor owns the agent presses it. The turn keeps running, and
   * only that person is told why, in an ephemeral message.
   */
  it("refuses somebody who neither asked nor owns the agent", async () => {
    const h = harness();
    await h.mention();

    await h.stop(STRANGER);
    await tick();

    expect(h.cancelled).toEqual([]);
    expect(h.ephemerals()).toEqual([
      expect.objectContaining({
        user: STRANGER,
        text: expect.stringContaining("Only the person who asked"),
      }),
    ]);

    h.finish();
    await h.settle();
    expect(h.turnEvents()).toEqual([
      expect.not.objectContaining({ reason: "stopped" }),
    ]);
  });

  /**
   * TEST_SCENARIO: The turn already ended when Stop arrives — Slack can
   * deliver the event after the last frame. Nothing is cancelled and nobody
   * is messaged; the status is cleared, so the button does not stay up.
   */
  it("is a no-op on a turn that already finished", async () => {
    const h = harness();
    await h.mention();
    h.finish();
    await h.settle();
    h.gw.resetOutbound();

    await h.stop(ASKER);

    expect(h.cancelled).toEqual([]);
    expect(h.ephemerals()).toEqual([]);
    expect(h.gw.readOutbound()).toEqual([
      expect.objectContaining({ kind: "status", status: "" }),
    ]);
  });

  /**
   * TEST_SCENARIO: Slack lists the streams it stopped in
   * streaming_message_ts. Each one is finished with chat.stopStream, so no
   * message is left open in the thread.
   */
  it("finishes the streams Slack names", async () => {
    const h = harness();
    await h.mention();

    await h.stop(ASKER, ["9.1"]);
    await h.settle();

    expect(h.gw.readOutbound()).toContainEqual(
      expect.objectContaining({ kind: "stream_stop", ts: "9.1" }),
    );
  });
});
