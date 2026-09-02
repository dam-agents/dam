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
import type { StoredChannelConfig } from "../../modules/channels/stored-channel.js";

const OWNER = "kc|owner-1";
const BOUND = "C-BOUND";
configureLogger({ level: "error", write: () => {} });

function harness(opts: {
  boundChannelId: string | null;
  extraBoundChannelIds?: string[];
  channels?: FakeSlackChannel[];
  gatewayDown?: boolean;
}) {
  const gw = createFakeSlackGateway();
  gw.setChannels(opts.channels ?? []);
  if (opts.gatewayDown) {
    gw.start = async () => false;
  }
  const acp = {
    listSessions: async () => [],
    sendPrompt: async () => "x",
    triggerSession: () => Promise.reject(new Error("unused")),
  } as unknown as AcpClient;
  const agents = {
    ensureReady: async () => {},
  } as unknown as AgentsService;

  const worker = createSlackWorker(
    () => acp,
    () => gw,
    () => agents,
    { resolve: async () => null } as never,
    { authUrl: "http://kc", clientId: "c" } as never,
    createMemoryTtlStore(600_000),
    async () => OWNER,
    {
      resolveSlackBindings: async () => [],
      resolveSlackChannelsByInstance: async () =>
        opts.boundChannelId
          ? [opts.boundChannelId, ...(opts.extraBoundChannelIds ?? [])]
          : [],
    },
    async () => {},
    async () => {},
    async () => true,
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
    async post(
      text: string,
      options?: Parameters<typeof worker.postMessage>[2],
    ) {
      await worker.start("agent-1", {} as StoredChannelConfig);
      return worker.postMessage("agent-1", text, options);
    },
    async list() {
      await worker.start("agent-1", {} as StoredChannelConfig);
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
