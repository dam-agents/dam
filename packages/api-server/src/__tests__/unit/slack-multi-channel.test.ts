import { createMemoryTtlStore } from "../../core/ttl-store.js";
import { describe, it, expect } from "vitest";
import { slackThreadKey, type AgentsService } from "api-server-api";
import { createSlackWorker } from "../../modules/channels/infrastructure/slack.js";
import { createFakeSlackGateway } from "../../modules/channels/infrastructure/fake-slack-gateway.js";
import { stubTurnAttendance } from "../helpers/turn-attendance.js";
import { stubWorkspaceFiles } from "../helpers/workspace-files.js";
import type { AcpClient, SendPromptOpts } from "../../core/acp-client.js";
import { configureLogger } from "../../core/logger.js";
import type { StoredChannelConfig } from "../../modules/channels/stored-channel.js";

const OWNER = "kc|owner-1";
const C_ONE = "C-ONE";
const C_TWO = "C-TWO";
configureLogger({ level: "error", write: () => {} });

const tick = () => new Promise((r) => setTimeout(r, 0));

/** One agent bound to two Slack conversations (#3086). Records the session key
 *  every fresh prompt was minted under, and which session a resume targeted. */
function harness(opts?: {
  sessions?: Array<{ sessionId: string; platform: { threadTs: string } }>;
}) {
  const gw = createFakeSlackGateway();
  gw.setChannels([
    { id: C_ONE, name: "one", botIsMember: true },
    { id: C_TWO, name: "two", botIsMember: true },
  ]);
  const freshKeys: string[] = [];
  const resumed: string[] = [];
  const acp: AcpClient = {
    listSessions: async () => opts?.sessions ?? [],
    sendPrompt: async (_prompt: unknown, sendOpts: SendPromptOpts) => {
      if ("resumeSessionId" in sendOpts) resumed.push(sendOpts.resumeSessionId);
      else freshKeys.push(sendOpts.platformMeta?.threadTs ?? "unknown");
      return "answer";
    },
    triggerSession: () => Promise.reject(new Error("unused")),
  };
  const agents = { ensureReady: async () => {} } as unknown as AgentsService;

  const worker = createSlackWorker(
    () => acp,
    () => gw,
    () => agents,
    { resolve: async () => OWNER } as never,
    { authUrl: "http://kc", clientId: "c" } as never,
    createMemoryTtlStore(600_000),
    async () => OWNER,
    {
      resolveSlackBinding: async () => ({
        instanceName: "agent-1",
        owner: OWNER,
      }),
      resolveSlackChannelsByInstance: async () => [C_ONE, C_TWO],
    },
    async () => {},
    async () => {},
    { name: "DAM", short: "dam" },
    async () => true,
    "http://ui",
    stubTurnAttendance(),
    stubWorkspaceFiles(),
    () => {},
  );

  return {
    gw,
    worker,
    freshKeys,
    resumed,
    async mention(channel: string, ts: string) {
      await worker.start("agent-1", {} as StoredChannelConfig);
      await gw.fireMention({
        user: "U1",
        channel,
        ts,
        text: "hi agent",
        teamId: "T-e2e",
      });
      await tick();
    },
    messages: () => gw.readOutbound().filter((r) => r.kind === "message"),
  };
}

describe("slack multi-channel bindings (#3086) — session isolation", () => {
  it("the same thread_ts in two channels drives two separate sessions", async () => {
    // Slack timestamps are only unique within a conversation, so an
    // unqualified key would make these one shared session — the exact leak
    // between unrelated channels the binding model must not allow.
    const h = harness();
    await h.mention(C_ONE, "9.9");
    await h.mention(C_TWO, "9.9");

    expect(h.freshKeys).toEqual([
      slackThreadKey(C_ONE, "9.9"),
      slackThreadKey(C_TWO, "9.9"),
    ]);
    expect(h.resumed).toHaveLength(0);
  });

  it("a channel's thread never resumes another channel's same-ts session", async () => {
    const h = harness({
      sessions: [
        {
          sessionId: "s-one",
          platform: { threadTs: slackThreadKey(C_ONE, "9.9") },
        },
      ],
    });
    await h.mention(C_TWO, "9.9");

    expect(h.resumed).toHaveLength(0);
    expect(h.freshKeys).toEqual([slackThreadKey(C_TWO, "9.9")]);
  });

  it("resumes its own channel's session", async () => {
    const h = harness({
      sessions: [
        {
          sessionId: "s-one",
          platform: { threadTs: slackThreadKey(C_ONE, "9.9") },
        },
      ],
    });
    await h.mention(C_ONE, "9.9");

    expect(h.resumed).toEqual(["s-one"]);
    expect(h.freshKeys).toHaveLength(0);
  });

  it("resumes a session keyed the pre-#3086 way, so live threads survive the upgrade", async () => {
    const h = harness({
      sessions: [{ sessionId: "s-legacy", platform: { threadTs: "9.9" } }],
    });
    await h.mention(C_ONE, "9.9");

    expect(h.resumed).toEqual(["s-legacy"]);
  });

  it("prefers the qualified session over a legacy one with the same ts", async () => {
    const h = harness({
      sessions: [
        { sessionId: "s-legacy", platform: { threadTs: "9.9" } },
        {
          sessionId: "s-qualified",
          platform: { threadTs: slackThreadKey(C_ONE, "9.9") },
        },
      ],
    });
    await h.mention(C_ONE, "9.9");

    expect(h.resumed).toEqual(["s-qualified"]);
  });

  it("an id-less reply lands in the channel its turn came from", async () => {
    // With one binding the bound channel was a safe default; with several it
    // is not — the reply must follow the turn, not the binding list.
    const h = harness();
    await h.mention(C_TWO, "4.4");
    h.gw.resetOutbound();

    expect(await h.worker.reply("agent-1", { text: "answering" })).toEqual({
      ok: true,
    });
    expect(h.messages()).toMatchObject([
      { channel: C_TWO, threadTs: "4.4", text: "answering" },
    ]);
  });
});
