import { createMemoryTtlStore } from "../../core/ttl-store.js";
import { describe, it, expect } from "vitest";
import type { AgentsService } from "api-server-api";
import { createSlackWorker } from "../../modules/channels/infrastructure/slack.js";
import { stubTurnAttendance } from "../helpers/turn-attendance.js";
import { stubWorkspaceFiles } from "../helpers/workspace-files.js";
import {
  createFakeSlackGateway,
  type FakeSlackChannel,
} from "../../modules/channels/infrastructure/fake-slack-gateway.js";
import type { AcpClient } from "../../core/acp-client.js";
import { configureLogger } from "../../core/logger.js";

const OWNER = "kc|owner-1";
const BOUND = "C-BOUND";
configureLogger({ level: "error", write: () => {} });

function harness(opts: {
  boundChannelId: string | null;
  extraBoundChannelIds?: string[];
  channels?: FakeSlackChannel[];
  gatewayDown?: boolean;
  workspace?: string;
}) {
  const gw = createFakeSlackGateway();
  gw.setChannels(opts.channels ?? [], opts.workspace ?? "");
  if (opts.gatewayDown) {
    gw.start = async () => false;
  }
  const acp = {
    listSessions: async () => [],
    sendPrompt: async () => "x",
    triggerSession: () => Promise.reject(new Error("unused")),
    turnStatus: async () => "unknown" as const,
  } as unknown as AcpClient;
  const agents = {
    ensureReady: async () => {},
  } as unknown as AgentsService;

  const worker = createSlackWorker({
    makeAcpClient: () => acp,
    createGateway: () => gw,
    agents: () => agents,
    identityLinks: { resolve: async () => null } as never,
    oauthConfig: { authUrl: "http://kc", clientId: "c" } as never,
    pendingOAuthFlows: createMemoryTtlStore(600_000),
    getInstanceOwner: async () => OWNER,
    channelRegistry: {
      resolveSlackBindings: async () => [],
      resolveSlackChannelsByInstance: async () =>
        opts.boundChannelId
          ? [opts.boundChannelId, ...(opts.extraBoundChannelIds ?? [])].map(
              (id) => ({ id, teamId: opts.workspace ?? "" }),
            )
          : [],
    },
    unbindSlackChannel: async () => {},
    setSlackChannelAmbient: async () => {},
    setSlackDefault: async () => true,
    brand: { name: "DAM", short: "dam" },
    isTermsAccepted: async () => true,
    uiBaseUrl: "http://ui",
    attendance: stubTurnAttendance(),
    workspaceFiles: stubWorkspaceFiles(),
    canonicalWorkspace: (teamId) => teamId,
    emit: () => {},
  });

  return {
    gw,
    worker,
    async post(
      text: string,
      options?: Parameters<typeof worker.postMessage>[2],
    ) {
      await worker.start("agent-1");
      return worker.postMessage("agent-1", text, options);
    },
    async list() {
      await worker.start("agent-1");
      return worker.listConversations("agent-1");
    },
    messages: () => gw.readOutbound().filter((r) => r.kind === "message"),
    uploads: () => gw.readOutbound().filter((r) => r.kind === "upload"),
  };
}

const workspace: FakeSlackChannel[] = [
  { id: BOUND, name: "agent-home", botIsMember: true },
  { id: "C-GENERAL", name: "general", botIsMember: true },
  { id: "C-ALERTS", name: "alerts", botIsMember: true },
  { id: "C-STAFF", name: "staff", botIsMember: false },
];

describe("slack outbound — cross-workspace reach", () => {
  it("unbound agent: post errors and lists nothing — the binding is the gate", async () => {
    const h = harness({ boundChannelId: null, channels: workspace });
    expect(await h.post("hi")).toEqual({ error: "no channel connected" });
    expect(await h.list()).toEqual([]);
    expect(h.gw.readOutbound()).toHaveLength(0);
  });

  it("gateway down: post errors as a value", async () => {
    const h = harness({
      boundChannelId: BOUND,
      channels: workspace,
      gatewayDown: true,
    });
    expect(await h.post("hi")).toEqual({ error: "slack bot not running" });
  });

  /**
   * TEST_SCENARIO: a worker with no Slack connection refuses the
   * which-workspace-sees-this question instead of answering it. The answer is
   * read as Slack's own word on the conversation, so "I cannot ask" arriving
   * as "unknown" would report a conversation nobody could see — indicting a
   * conversation id that was never in question, on every replica that does
   * not hold the lease.
   */
  it("refuses the standing question when the gateway is not connected here", async () => {
    const h = harness({ boundChannelId: BOUND, channels: workspace });

    await expect(h.worker.conversationStanding(BOUND, "")).rejects.toThrow();
  });

  // TEST_SCENARIO: an outbound call racing a lease stand-down must not resurrect the gateway on the ex-leader — that would be a second install-wide Slack consumer.
  it("stand-down is final: outbound after stopAll does not restart the gateway", async () => {
    const h = harness({ boundChannelId: BOUND, channels: workspace });
    await h.worker.connect();
    let restarts = 0;
    const start = h.gw.start.bind(h.gw);
    h.gw.start = async (handlers) => {
      restarts += 1;
      return start(handlers);
    };
    await h.worker.stopAll();

    expect(await h.worker.postMessage("agent-1", "late")).toEqual({
      error: "slack bot not running",
    });
    expect(restarts).toBe(0);
    expect(h.messages()).toHaveLength(0);
  });

  it("omitted chatId still posts to the bound channel", async () => {
    const h = harness({ boundChannelId: BOUND, channels: workspace });
    expect(await h.post("hello")).toEqual({ ok: true });
    expect(h.messages()).toMatchObject([{ channel: BOUND, text: "hello" }]);
  });

  it("passes explicit unfurl controls through to Slack while omitting defaults", async () => {
    const h = harness({ boundChannelId: BOUND, channels: workspace });
    await h.post("no cards", { unfurlLinks: false, unfurlMedia: false });
    await h.post("Slack defaults");

    expect(h.messages()).toMatchObject([
      {
        channel: BOUND,
        text: "no cards",
        unfurlLinks: false,
        unfurlMedia: false,
      },
      { channel: BOUND, text: "Slack defaults" },
    ]);
    expect(h.messages()[1]).not.toHaveProperty("unfurlLinks");
    expect(h.messages()[1]).not.toHaveProperty("unfurlMedia");
  });

  it("bound-channel chatId short-circuits — works even when discovery knows nothing", async () => {
    const h = harness({ boundChannelId: BOUND, channels: [] });
    expect(await h.post("hello", { conversationId: BOUND })).toEqual({
      ok: true,
    });
    expect(h.messages()).toMatchObject([{ channel: BOUND }]);
  });

  it("posts into another channel the bot is a member of", async () => {
    const h = harness({ boundChannelId: BOUND, channels: workspace });
    expect(await h.post("update", { conversationId: "C-GENERAL" })).toEqual({
      ok: true,
    });
    expect(h.messages()).toMatchObject([{ channel: "C-GENERAL" }]);
  });

  it("refuses a channel the bot is not a member of, pointing at /invite", async () => {
    const h = harness({ boundChannelId: BOUND, channels: workspace });
    const result = await h.post("nope", { conversationId: "C-STAFF" });
    expect(result).toMatchObject({
      error: expect.stringContaining("not a member"),
    });
    expect((result as { error: string }).error).toContain("/invite");
    expect(h.gw.readOutbound()).toHaveLength(0);
  });

  it("refuses an unknown or invisible (private) conversation", async () => {
    const h = harness({ boundChannelId: BOUND, channels: workspace });
    const result = await h.post("nope", { conversationId: "C-NOWHERE" });
    expect(result).toMatchObject({
      error: expect.stringContaining("conversation C-NOWHERE not found"),
    });
    expect((result as { error: string }).error).toContain("/invite");
    expect(h.gw.readOutbound()).toHaveLength(0);
  });

  it("a user id opens a direct message and posts into it", async () => {
    const h = harness({ boundChannelId: BOUND, channels: workspace });
    expect(await h.post("psst", { conversationId: "UTEAMMATE" })).toEqual({
      ok: true,
    });
    expect(h.messages()).toMatchObject([{ channel: "D-UTEAMMATE" }]);
  });

  it("refuses a comma-separated user list — DMs are single-user, never group DMs", async () => {
    const h = harness({ boundChannelId: BOUND, channels: workspace });
    const result = await h.post("psst", { conversationId: "UAAA,UBBB" });
    expect(result).toMatchObject({
      error: expect.stringContaining("not found"),
    });
    expect(h.gw.readOutbound()).toHaveLength(0);
  });

  it("refuses an empty send — no DM gets opened as a side effect", async () => {
    const h = harness({ boundChannelId: BOUND, channels: workspace });
    expect(await h.post("", { conversationId: "UTEAMMATE" })).toEqual({
      error: "nothing to send — pass text or an attachment",
    });
    expect(h.gw.readOutbound()).toHaveLength(0);
  });

  it("an existing DM conversation id passes through untouched", async () => {
    const h = harness({ boundChannelId: BOUND, channels: workspace });
    expect(await h.post("again", { conversationId: "D-EXISTING" })).toEqual({
      ok: true,
    });
    expect(h.messages()).toMatchObject([{ channel: "D-EXISTING" }]);
  });

  it("attachments follow the resolved target", async () => {
    const h = harness({ boundChannelId: BOUND, channels: workspace });
    const result = await h.post("report attached", {
      conversationId: "C-ALERTS",
      attachment: { filename: "report.md", data: Buffer.from("x") },
    });
    expect(result).toEqual({ ok: true });
    expect(h.messages()).toMatchObject([{ channel: "C-ALERTS" }]);
    expect(h.uploads()).toMatchObject([
      { channelId: "C-ALERTS", filename: "report.md" },
    ]);
  });

  it("a reply's attachment is uploaded into the same thread", async () => {
    const h = harness({ boundChannelId: BOUND, channels: workspace });
    await h.worker.start("agent-1");
    const result = await h.worker.reply("agent-1", {
      text: "lorem ipsum attached",
      threadTs: "1700000000.000100",
      attachment: { filename: "lorem-ipsum.txt", data: Buffer.from("x") },
    });
    expect(result).toEqual({ ok: true });
    expect(h.messages()).toMatchObject([
      { channel: BOUND, threadTs: "1700000000.000100" },
    ]);
    expect(h.uploads()).toEqual([
      {
        kind: "upload",
        teamId: "",
        channelId: BOUND,
        filename: "lorem-ipsum.txt",
        threadTs: "1700000000.000100",
      },
    ]);
  });

  it("a failed upload after a delivered text message says the text landed", async () => {
    const h = harness({ boundChannelId: BOUND, channels: workspace });
    h.gw.uploadFile = async () => {
      throw new Error("upload_error");
    };
    const result = await h.post("report attached", {
      conversationId: "C-ALERTS",
      attachment: { filename: "report.md", data: Buffer.from("x") },
    });
    expect(result).toMatchObject({
      error: expect.stringContaining("message posted, but"),
    });
    expect(h.messages()).toMatchObject([{ channel: "C-ALERTS" }]);
  });

  it("listConversations: bound channel first with its #name, then member channels by name", async () => {
    const h = harness({ boundChannelId: BOUND, channels: workspace });
    expect(await h.list()).toEqual([
      { id: BOUND, title: "#agent-home" },
      { id: "C-ALERTS", title: "#alerts" },
      { id: "C-GENERAL", title: "#general" },
    ]);
  });

  it("listConversations degrades to the bound channel when discovery fails", async () => {
    const h = harness({ boundChannelId: BOUND, channels: workspace });
    h.gw.listBotChannels = async () => {
      throw new Error("missing_scope");
    };
    expect(await h.list()).toEqual([{ id: BOUND, title: BOUND }]);
  });
});

describe("slack outbound — an agent bound to several conversations (#3086)", () => {
  const SECOND = "C-SECOND";
  const multi = () =>
    harness({
      boundChannelId: BOUND,
      extraBoundChannelIds: [SECOND],
      channels: [
        ...workspace,
        { id: SECOND, name: "second-home", botIsMember: true },
      ],
    });

  it("refuses an omitted chatId and names the candidates — there is no single default", async () => {
    const h = multi();
    expect(await h.post("hello")).toMatchObject({
      error: expect.stringContaining("pass chatId"),
    });
    expect(await h.post("hello")).toMatchObject({
      error: expect.stringContaining(SECOND),
    });
    expect(h.messages()).toHaveLength(0);
  });

  it("either bound conversation is a valid chatId", async () => {
    const h = multi();
    expect(await h.post("one", { conversationId: BOUND })).toEqual({
      ok: true,
    });
    expect(await h.post("two", { conversationId: SECOND })).toEqual({
      ok: true,
    });
    expect(h.messages()).toMatchObject([
      { channel: BOUND, text: "one" },
      { channel: SECOND, text: "two" },
    ]);
  });

  it("every bound conversation short-circuits discovery, not just the first", async () => {
    const h = harness({
      boundChannelId: BOUND,
      extraBoundChannelIds: [SECOND],
      channels: [],
    });
    expect(await h.post("hi", { conversationId: SECOND })).toEqual({
      ok: true,
    });
    expect(h.messages()).toMatchObject([{ channel: SECOND }]);
  });

  it("listConversations leads with every bound conversation, then the rest", async () => {
    const h = multi();
    expect(await h.list()).toEqual([
      { id: BOUND, title: "#agent-home" },
      { id: SECOND, title: "#second-home" },
      { id: "C-ALERTS", title: "#alerts" },
      { id: "C-GENERAL", title: "#general" },
    ]);
  });
});

describe("slack outbound — which workspace a post goes out under", () => {
  /**
   * TEST_SCENARIO: The install that predates multi-workspace support. Its
   * bindings carry no workspace, so posts go out under the operator's own
   * token exactly as they always did — the backward compatibility the whole
   * design rests on, asserted rather than assumed.
   */
  it("posts under the original workspace when the binding names none", async () => {
    const h = harness({ boundChannelId: BOUND, channels: workspace });

    expect(await h.post("hello")).toMatchObject({ ok: true });
    expect(h.messages()).toMatchObject([{ channel: BOUND, teamId: "" }]);
  });

  /**
   * TEST_SCENARIO: A conversation in a workspace connected over OAuth. The post
   * must go out under that workspace's own credential — sending it under the
   * operator's token is the defect this whole change exists to fix, and it is
   * invisible from the reply itself, so only the workspace on the wire proves
   * it.
   */
  it("posts under the binding's own workspace", async () => {
    const h = harness({
      boundChannelId: BOUND,
      channels: workspace,
      workspace: "T-SECOND",
    });

    expect(await h.post("hello")).toMatchObject({ ok: true });
    expect(h.messages()).toMatchObject([
      { channel: BOUND, teamId: "T-SECOND" },
    ]);
  });

  /**
   * TEST_SCENARIO: Listing an agent's reachable conversations asks the
   * workspace the agent is bound in. A channel only the original workspace can
   * see must not surface for an agent bound elsewhere, or the agent would be
   * offered somewhere it cannot post.
   */
  it("lists the conversations of the workspace the agent is bound in", async () => {
    const h = harness({
      boundChannelId: BOUND,
      channels: workspace,
      workspace: "T-SECOND",
    });
    h.gw.setChannels(
      [{ id: "C-ELSEWHERE", name: "elsewhere", botIsMember: true }],
      "",
    );

    const listed = (await h.list()).map((c) => c.id);
    expect(listed).toContain(BOUND);
    expect(listed).not.toContain("C-ELSEWHERE");
  });
});
