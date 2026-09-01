import { createMemoryTtlStore } from "../../core/ttl-store.js";
import { describe, it, expect } from "vitest";
import { type AgentsService } from "api-server-api";
import type { ContentBlock } from "@agentclientprotocol/sdk/dist/schema/types.gen.js";
import { createSlackWorker } from "../../modules/channels/infrastructure/slack.js";
import { createFakeSlackGateway } from "../../modules/channels/infrastructure/fake-slack-gateway.js";
import { stubTurnAttendance } from "../helpers/turn-attendance.js";
import { stubWorkspaceFiles } from "../helpers/workspace-files.js";
import type { AcpClient, SteerOutcome } from "../../core/acp-client.js";
import { configureLogger } from "../../core/logger.js";
import type { DomainEvent } from "../../events.js";
import type { StoredChannelConfig } from "../../modules/channels/stored-channel.js";

const OWNER = "kc|owner-1";
const SESSION = "sess-1";

configureLogger({ level: "error", write: () => {} });

const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * TEST_OVERVIEW: How an addressed Slack conversation turns several messages
 * into one answer. Messages waiting when a turn has not started yet go into
 * that turn together. A message arriving while a turn runs is steered into it,
 * so the agent reads it before it calls its reply tool and answers once. Where
 * the harness does not support steering the message waits and becomes the next
 * turn, which is the old behaviour minus the extra turns.
 */

type Gate = { release: () => void };

function harness(opts: { steer?: () => SteerOutcome; settleMs?: number } = {}) {
  const gw = createFakeSlackGateway();
  const events: DomainEvent[] = [];
  const prompts: Array<string | ContentBlock[]> = [];
  const steered: string[] = [];
  const gates: Gate[] = [];
  let holdTurns = false;

  const acp: AcpClient = {
    listSessions: async () => [],
    steer: async (_sessionId, prompt) => {
      steered.push(
        typeof prompt === "string" ? prompt : JSON.stringify(prompt),
      );
      return opts.steer ? opts.steer() : "unsupported";
    },
    sendPrompt: async (prompt, sendOpts) => {
      prompts.push(prompt);
      sendOpts.onSession?.(SESSION);
      if (holdTurns) {
        await new Promise<void>((resolve) => gates.push({ release: resolve }));
      }
      return "the answer";
    },
    triggerSession: () => Promise.reject(new Error("unused")),
  };

  const worker = createSlackWorker(
    () => acp,
    () => gw,
    () => ({ ensureReady: async () => {} }) as unknown as AgentsService,
    { resolve: async () => OWNER } as never,
    { authUrl: "http://kc", clientId: "c" } as never,
    createMemoryTtlStore(600_000),
    async () => OWNER,
    {
      resolveSlackBindings: async () => [
        {
          instanceName: "agent-1",
          owner: OWNER,
          ambient: false,
          isDefault: true,
        },
      ],
      resolveSlackChannelsByInstance: async () => ["C1"],
    } as never,
    async () => {},
    async () => {},
    async () => true,
    { name: "DAM", short: "dam" },
    async () => true,
    "http://ui",
    stubTurnAttendance(),
    stubWorkspaceFiles(),
    (e) => events.push(e),
    opts.settleMs ?? 0,
  );

  return {
    gw,
    prompts,
    steered,
    worker,
    async start() {
      await worker.start("agent-1", {} as StoredChannelConfig);
    },
    hold() {
      holdTurns = true;
    },
    releaseAll() {
      holdTurns = false;
      for (const g of gates) g.release();
      gates.length = 0;
    },
    fire(ts: string, text: string, threadTs?: string, user = "U1") {
      return gw.fireMention({
        user,
        channel: "C1",
        ts,
        ...(threadTs !== undefined ? { threadTs } : {}),
        text,
        teamId: "T-e2e",
      });
    },
    async waitFor(done: () => boolean) {
      for (let i = 0; i < 400 && !done(); i++) await tick();
    },
  };
}

describe("slack addressed turns — coalescing", () => {
  /**
   * TEST_SCENARIO: A thought split over two messages in a thread, both arriving
   * before the turn starts, must produce one turn carrying both — the reported
   * bug was one turn (and one answer) per message.
   */
  it("carries a settled burst into a single turn", async () => {
    const h = harness({ settleMs: 5 });
    await h.start();

    const first = h.fire("100.1", "can you check the deploy", "T1");
    await tick();
    const second = h.fire("100.2", "specifically the migration", "T1");
    await Promise.all([first, second]);

    expect(h.prompts).toHaveLength(1);
    const prompt = String(h.prompts[0]);
    expect(prompt).toContain("can you check the deploy");
    expect(prompt).toContain("specifically the migration");
    expect(prompt).toContain("[ts 100.1]");
    expect(prompt).toContain("[ts 100.2]");
  });

  /**
   * TEST_SCENARIO: The mid-turn case steering exists for: the agent is already
   * working when the rest of the thought lands. It must reach the running turn
   * rather than start a second one, so the conversation gets one answer.
   */
  it("steers a message that arrives while a turn is running", async () => {
    const h = harness({ steer: () => "injected" });
    await h.start();
    h.hold();

    void h.fire("100.1", "can you check the deploy", "T1");
    await h.waitFor(() => h.prompts.length === 1);

    void h.fire("100.2", "specifically the migration", "T1");
    await h.waitFor(() => h.steered.length === 1);

    expect(h.steered).toHaveLength(1);
    expect(h.steered[0]).toContain("specifically the migration");
    expect(h.steered[0]).toContain("answer everything in one reply");

    h.releaseAll();
    await h.waitFor(() => false);
    expect(h.prompts).toHaveLength(1);
  });

  /**
   * TEST_SCENARIO: Not every harness supports steering. There the message must
   * still be answered — as the next turn — rather than dropped, and it must not
   * run alongside the turn already in flight.
   */
  it("falls back to a following turn when the harness cannot be steered", async () => {
    const h = harness({ steer: () => "unsupported" });
    await h.start();
    h.hold();

    void h.fire("100.1", "first half", "T1");
    await h.waitFor(() => h.prompts.length === 1);

    void h.fire("100.2", "second half", "T1");
    await h.waitFor(() => h.steered.length === 1);
    expect(h.prompts).toHaveLength(1);

    h.releaseAll();
    await h.waitFor(() => h.prompts.length === 2);

    expect(h.prompts).toHaveLength(2);
    expect(String(h.prompts[1])).toContain("second half");
  });

  /**
   * TEST_SCENARIO: Two people addressing the agent about different things are
   * two conversations, not one thought — merging them would answer one person
   * under the other's message, so they stay separate turns.
   */
  it("keeps two senders' top-level mentions apart", async () => {
    const h = harness({ settleMs: 5 });
    await h.start();

    const a = h.fire("100.1", "question from one", undefined, "U1");
    const b = h.fire("200.2", "question from two", undefined, "U2");
    await Promise.all([a, b]);

    expect(h.prompts).toHaveLength(2);
  });

  /**
   * TEST_SCENARIO: A single message must not gain batch framing — the [ts …]
   * tags and the multi-message contract only make sense for a real batch.
   */
  it("leaves a lone message unbatched", async () => {
    const h = harness({ settleMs: 5 });
    await h.start();

    await h.fire("100.1", "just the one", "T1");

    expect(h.prompts).toHaveLength(1);
    expect(String(h.prompts[0])).not.toContain("[ts 100.1]");
  });
});
