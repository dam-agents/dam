import { createMemoryTtlStore } from "../../core/ttl-store.js";
import { describe, it, expect, vi } from "vitest";
import type { AgentsService } from "api-server-api";
import { createSlackWorker } from "../../modules/channels/infrastructure/slack.js";
import { buildChannelCard } from "../../modules/channels/infrastructure/channel-card.js";
import { stubTurnAttendance } from "../helpers/turn-attendance.js";
import { stubWorkspaceFiles } from "../helpers/workspace-files.js";
import {
  createFakeSlackGateway,
  type FakeSlackChannel,
} from "../../modules/channels/infrastructure/fake-slack-gateway.js";
import type { AcpClient } from "../../core/acp-client.js";
import { configureLogger } from "../../core/logger.js";
import { artifactLinks, type StubArtifact } from "../helpers/artifact-links.js";
import type { LinkOutboundArtifacts } from "../../modules/channels/infrastructure/outbound-artifact-links.js";

const OWNER = "kc|owner-1";
const BOUND = "C-BOUND";
const OWNER_SLACK = "U-OWNER";
const signed = (t: string, bold = "*") =>
  `:robot_face: ${bold}agent-1${bold}\n\n${t}`;
configureLogger({ level: "error", write: () => {} });

function harness(opts: {
  boundChannelId: string | null;
  extraBoundChannelIds?: string[];
  channels?: FakeSlackChannel[];
  gatewayDown?: boolean;
  workspace?: string;
  ownerSlackUsers?: string[];
  ownerSlackLinks?: { id: string; teamId: string | null }[];
  workspaces?: string[];
  identityLinksFail?: boolean;
  artifacts?: StubArtifact[];
  linkArtifacts?: LinkOutboundArtifacts;
}) {
  const gw = createFakeSlackGateway();
  gw.setChannels(opts.channels ?? [], opts.workspace ?? "");
  if (opts.gatewayDown) {
    gw.start = async () => false;
  }
  const acp = {
    steer: async () => "unsupported" as const,
    listSessions: async () => [],
    sendPrompt: async () => "x",
    triggerSession: () => Promise.reject(new Error("unused")),
    turnStatus: async () => "unknown" as const,
  } as unknown as AcpClient;
  const registry = {
    resolveSlackBindings: async () => [],
    resolveSlackChannelsByInstance: async () =>
      opts.boundChannelId
        ? [opts.boundChannelId, ...(opts.extraBoundChannelIds ?? [])].map(
            (id) => ({ id, teamId: opts.workspace ?? "" }),
          )
        : [],
  };
  const agents = {
    ensureReady: async () => {},
  } as unknown as AgentsService;

  const worker = createSlackWorker({
    makeAcpClient: () => acp,
    createGateway: () => gw,
    agents: () => agents,
    identityLinks: {
      resolve: async () => null,
      externalUsersOf: async (_provider: string, sub: string) =>
        sub === OWNER ? (opts.ownerSlackUsers ?? [OWNER_SLACK]) : [],
      externalLinksOf: async (_provider: string, sub: string) => {
        if (opts.identityLinksFail) throw new Error("identity store down");
        return sub === OWNER
          ? (
              opts.ownerSlackLinks ?? [
                { id: OWNER_SLACK, teamId: opts.workspace ?? "" },
              ]
            ).map(({ id, teamId }) => ({ externalUserId: id, teamId }))
          : [];
      },
    } as never,
    oauthConfig: { authUrl: "http://kc", clientId: "c" } as never,
    pendingOAuthFlows: createMemoryTtlStore(600_000),
    getInstanceOwner: async () => OWNER,
    ownerDisplayName: async () => null,
    channelRegistry: registry as never,
    unbindSlackChannel: async () => {},
    setSlackChannelAmbient: async () => {},
    setSlackChannelHistory: async () => {},
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
    listWorkspaces: async () => opts.workspaces ?? [],
    emit: () => {},
    linkArtifacts:
      opts.linkArtifacts ?? artifactLinks(opts.artifacts ?? [], "http://ui"),
  });

  return {
    gw,
    worker,
    registry,
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
  {
    id: "C-GENERAL",
    name: "general",
    botIsMember: true,
    members: [OWNER_SLACK],
  },
  { id: "C-ALERTS", name: "alerts", botIsMember: true, members: [OWNER_SLACK] },
  { id: "C-STAFF", name: "staff", botIsMember: false },
];

describe("slack outbound — cross-workspace reach", () => {
  it("normalizes compact code fences on top-level posts too", async () => {
    const h = harness({ boundChannelId: BOUND, channels: workspace });
    const posts = vi.spyOn(h.gw, "postMessage");
    const text = "Before\n```ps -ef\nkill -9 <pid>```\nAfter.";

    expect(await h.post(text)).toMatchObject({ ok: true });
    expect(posts.mock.calls[0]![0]).toMatchObject({
      text: signed(text),
      blocks: [
        {
          type: "markdown",
          text: signed("Before\n```\nps -ef\nkill -9 <pid>\n```\nAfter.", "**"),
        },
        { type: "context" },
      ],
    });
  });

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

  it("omitted chatId still posts to the bound channel, and names the post", async () => {
    const h = harness({ boundChannelId: BOUND, channels: workspace });
    expect(await h.post("hello")).toEqual({
      ok: true,
      conversationId: BOUND,
      ts: expect.any(String),
    });
    expect(h.messages()).toMatchObject([
      { channel: BOUND, text: signed("hello") },
    ]);
  });

  it("passes explicit unfurl controls through to Slack while omitting defaults", async () => {
    const h = harness({ boundChannelId: BOUND, channels: workspace });
    await h.post("no cards", { unfurlLinks: false, unfurlMedia: false });
    await h.post("Slack defaults");

    expect(h.messages()).toMatchObject([
      {
        channel: BOUND,
        text: signed("no cards"),
        unfurlLinks: false,
        unfurlMedia: false,
      },
      { channel: BOUND, text: signed("Slack defaults") },
    ]);
    expect(h.messages()[1]).not.toHaveProperty("unfurlLinks");
    expect(h.messages()[1]).not.toHaveProperty("unfurlMedia");
  });

  it("bound-channel chatId short-circuits — works even when discovery knows nothing", async () => {
    const h = harness({ boundChannelId: BOUND, channels: [] });
    expect(await h.post("hello", { conversationId: BOUND })).toMatchObject({
      ok: true,
    });
    expect(h.messages()).toMatchObject([{ channel: BOUND }]);
  });

  it("posts into another channel the bot is a member of", async () => {
    const h = harness({ boundChannelId: BOUND, channels: workspace });
    expect(
      await h.post("update", { conversationId: "C-GENERAL" }),
    ).toMatchObject({
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
    const h = harness({
      boundChannelId: BOUND,
      channels: workspace,
      ownerSlackUsers: ["UOWNER"],
    });
    expect(await h.post("psst", { conversationId: "UOWNER" })).toMatchObject({
      ok: true,
      conversationId: "D-UOWNER",
    });
    expect(h.messages()).toMatchObject([{ channel: "D-UOWNER" }]);
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
      error: "nothing to send — pass text, a card or an attachment",
    });
    expect(h.gw.readOutbound()).toHaveLength(0);
  });

  it("an existing DM conversation id passes through untouched", async () => {
    const h = harness({
      boundChannelId: BOUND,
      channels: workspace,
      ownerSlackUsers: ["UOWNER"],
    });
    expect(await h.post("again", { conversationId: "D-UOWNER" })).toMatchObject(
      {
        ok: true,
      },
    );
    expect(h.messages()).toMatchObject([{ channel: "D-UOWNER" }]);
  });

  /**
   * TEST_SCENARIO: A message with a file is one Slack post: the file is shared
   * with the agent's text and footer on it, into the conversation the message
   * resolved to. Posting the text and then sharing the file made two posts, so
   * a reader saw a bare file next to the text it belonged to.
   */
  it("attachments follow the resolved target, on the post itself", async () => {
    const h = harness({ boundChannelId: BOUND, channels: workspace });
    const result = await h.post("report attached", {
      conversationId: "C-ALERTS",
      attachment: { filename: "report.md", data: Buffer.from("x") },
    });
    expect(result).toEqual({ ok: true, conversationId: "C-ALERTS" });
    expect(h.messages()).toEqual([]);
    expect(h.uploads()).toMatchObject([
      {
        channelId: "C-ALERTS",
        filename: "report.md",
        text: signed("report attached", "*"),
      },
    ]);
  });

  it("a reply's attachment is shared into the same thread, with its text", async () => {
    const h = harness({ boundChannelId: BOUND, channels: workspace });
    await h.worker.start("agent-1");
    const result = await h.worker.reply("agent-1", {
      text: "lorem ipsum attached",
      threadTs: "1700000000.000100",
      attachment: { filename: "lorem-ipsum.txt", data: Buffer.from("x") },
    });
    expect(result).toMatchObject({ ok: true });
    expect(h.messages()).toEqual([]);
    expect(h.uploads()).toEqual([
      {
        kind: "upload",
        teamId: "",
        channelId: BOUND,
        filename: "lorem-ipsum.txt",
        threadTs: "1700000000.000100",
        text: signed("lorem ipsum attached", "*"),
      },
    ]);
  });

  /**
   * TEST_SCENARIO: Slack can refuse a file share that carries the text, for
   * example for blocks it will not take on a file. The text must still reach
   * the conversation, so the worker falls back to the two posts: the text
   * first, with the file's id in its metadata, then the bare file. Slack
   * completes an upload only once, so the fallback uploads the file again.
   */
  it("a file share Slack refuses with the text falls back to the text, then the file", async () => {
    const h = harness({ boundChannelId: BOUND, channels: workspace });
    const share = h.gw.shareFile.bind(h.gw);
    const shared: string[] = [];
    h.gw.shareFile = async (args) => {
      shared.push(args.fileId);
      if (args.blocks) throw new Error("internal_error");
      await share(args);
    };
    const posts = vi.spyOn(h.gw, "postMessage");
    const result = await h.post("report attached", {
      conversationId: "C-ALERTS",
      attachment: { filename: "report.md", data: Buffer.from("x") },
    });
    expect(result).toMatchObject({ ok: true });
    expect(
      h.gw
        .readOutbound()
        .filter((r) => r.kind === "message" || r.kind === "upload"),
    ).toMatchObject([
      { kind: "message", channel: "C-ALERTS", text: signed("report attached") },
      { kind: "upload", channelId: "C-ALERTS", filename: "report.md" },
    ]);
    expect(h.uploads()[0]).not.toHaveProperty("text");
    expect(shared).toEqual(["F1-report.md", "F2-report.md"]);
    expect(posts.mock.calls[0]![0].metadata).toEqual({
      eventType: "agent_post",
      payload: { files: ["F2-report.md"] },
    });
  });

  /**
   * TEST_SCENARIO: Slack has no unfurl switch on a file share, so an agent
   * that turns link previews off gets its text as its own post, where the
   * switch holds, and the file after it.
   */
  it("a message that turns link previews off keeps them off, beside its file", async () => {
    const h = harness({ boundChannelId: BOUND, channels: workspace });
    await h.post("see https://example.com", {
      conversationId: "C-ALERTS",
      unfurlLinks: false,
      attachment: { filename: "report.md", data: Buffer.from("x") },
    });
    expect(h.messages()).toMatchObject([
      { channel: "C-ALERTS", unfurlLinks: false },
    ]);
    expect(h.uploads()).toMatchObject([{ filename: "report.md" }]);
  });

  /**
   * TEST_SCENARIO: When the file share fails both with and without the text,
   * the text is already posted on its own. The send succeeded and only the
   * attachment is missing, so the result says ok and names the upload failure
   * beside it. Reporting it as a plain failure would read as nothing having
   * been sent, and the agent would send the whole message a second time.
   */
  it("a failed upload after a delivered text message says the text landed", async () => {
    const h = harness({ boundChannelId: BOUND, channels: workspace });
    h.gw.shareFile = async () => {
      throw new Error("upload_error");
    };
    const result = await h.post("report attached", {
      conversationId: "C-ALERTS",
      attachment: { filename: "report.md", data: Buffer.from("x") },
    });
    expect(result).toMatchObject({
      ok: true,
      attachmentError: expect.stringContaining("upload_error"),
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

function channelCard(tree: Record<string, unknown>) {
  const built = buildChannelCard(tree);
  if (!("card" in built)) throw new Error(built.issues.join("; "));
  return built.card;
}

const deploys = channelCard({
  type: "Card",
  props: { title: "Deploys" },
  children: [
    {
      type: "Fields",
      props: {},
      children: [{ type: "Field", props: { label: "Status", value: "green" } }],
    },
    {
      type: "Table",
      props: { headers: ["Week", "Deploys"], rows: [["W44", 12]] },
    },
  ],
});

describe("slack outbound — channel cards", () => {
  it("shows the text, then the card's blocks, then the footer, and notifies with both", async () => {
    const h = harness({ boundChannelId: BOUND, channels: workspace });
    const posts = vi.spyOn(h.gw, "postMessage");

    expect(await h.post("This week", { card: deploys })).toMatchObject({
      ok: true,
    });

    const sent = posts.mock.calls[0]![0];
    const types = (sent.blocks ?? []).map((block) => block.type);
    expect(sent.blocks?.[0]).toEqual({
      type: "markdown",
      text: signed("This week", "**"),
    });
    expect(types).toContain("data_table");
    expect(types.at(-1)).toBe("context");
    expect(sent.text).toContain("This week");
    expect(sent.text).toContain("Status");
  });

  /**
   * TEST_SCENARIO: Slack refuses blocks it cannot show, such as a table part a
   * workspace does not have or an image it cannot fetch. The answer must still
   * arrive, so the card goes out once more as its text form.
   */
  it("posts the card as text when Slack refuses its blocks", async () => {
    const h = harness({ boundChannelId: BOUND, channels: workspace });
    const post = h.gw.postMessage.bind(h.gw);
    const sent: Parameters<typeof post>[0][] = [];
    h.gw.postMessage = async (args) => {
      sent.push(args);
      if (args.blocks?.some((block) => block.type === "data_table"))
        throw Object.assign(new Error("invalid_blocks"), {
          data: { error: "invalid_blocks" },
        });
      return post(args);
    };

    expect(await h.post("This week", { card: deploys })).toMatchObject({
      ok: true,
    });

    expect(sent).toHaveLength(2);
    expect(sent[1]!.blocks).toEqual([
      {
        type: "markdown",
        text: signed(`This week\n\n${deploys.text}`, "**"),
      },
      expect.objectContaining({ type: "context" }),
    ]);
  });

  // TEST_SCENARIO: a card whose only text is blank renders no Slack block, and with no text of its own the post would show the Agent Footer alone.
  it("refuses a post that would show nothing but its footer", async () => {
    const h = harness({ boundChannelId: BOUND, channels: workspace });
    h.gw.setGrantedScopes(["chat:write", "chat:write.customize"]);
    const blank = channelCard({
      type: "Card",
      props: {},
      children: [{ type: "Text", props: { content: " " } }],
    });

    const result = await h.post("", { card: blank });

    expect(result).toMatchObject({
      error: expect.stringContaining("shows nothing"),
    });
    expect(h.messages()).toEqual([]);
  });

  it("refuses a card too long for one Slack message before anything posts", async () => {
    const h = harness({ boundChannelId: BOUND, channels: workspace });
    const long = channelCard({
      type: "Card",
      props: { title: "Every check" },
      children: Array.from({ length: 50 }, (_, i) => ({
        type: "Text",
        props: { content: `Check ${i + 1} passed` },
      })),
    });

    const result = await h.post("Checks", { card: long });

    const blocks = Number(
      ("error" in result && result.error.match(/is (\d+) Slack blocks/)?.[1]) ||
        0,
    );
    expect(blocks).toBeGreaterThanOrEqual(52);
    expect(h.messages()).toEqual([]);
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
      error: expect.stringContaining("as chatId"),
    });
    expect(await h.post("hello")).toMatchObject({
      error: expect.stringContaining(SECOND),
    });
    expect(h.messages()).toHaveLength(0);
  });

  it("a reply into a thread no live turn knows asks for one of the bound ids as chatId, and goes out once given one (#3753)", async () => {
    const h = multi();
    await h.worker.start("agent-1");
    const stale = { text: "late answer", threadTs: "1700000000.000200" };
    const refused = await h.worker.reply("agent-1", stale);
    expect(refused).toMatchObject({
      error: expect.stringContaining("as chatId"),
    });
    expect(refused).toMatchObject({
      error: expect.stringContaining(`${BOUND}, ${SECOND}`),
    });
    expect(
      await h.worker.reply("agent-1", { ...stale, conversationId: SECOND }),
    ).toMatchObject({ ok: true });
    expect(h.messages()).toMatchObject([
      { channel: SECOND, threadTs: stale.threadTs },
    ]);
  });

  it("either bound conversation is a valid chatId", async () => {
    const h = multi();
    expect(await h.post("one", { conversationId: BOUND })).toMatchObject({
      ok: true,
    });
    expect(await h.post("two", { conversationId: SECOND })).toMatchObject({
      ok: true,
    });
    expect(h.messages()).toMatchObject([
      { channel: BOUND, text: signed("one") },
      { channel: SECOND, text: signed("two") },
    ]);
  });

  it("every bound conversation short-circuits discovery, not just the first", async () => {
    const h = harness({
      boundChannelId: BOUND,
      extraBoundChannelIds: [SECOND],
      channels: [],
    });
    expect(await h.post("hi", { conversationId: SECOND })).toMatchObject({
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

describe("slack outbound — reach follows the owner (#4165)", () => {
  const channels: FakeSlackChannel[] = [
    ...workspace,
    {
      id: "C-THEIRS",
      name: "their-team",
      botIsMember: true,
      members: ["U-SOMEONE"],
    },
  ];

  /**
   * TEST_SCENARIO: The shared bot sits in channels of many teams. An agent
   * may list and post into only the channels its owner is a member of,
   * whoever supplied the chatId.
   */
  it("lists and posts into a channel only when the owner is in it", async () => {
    const h = harness({ boundChannelId: BOUND, channels });
    const listed = (await h.list()).map((c) => c.id);
    expect(listed).toContain("C-GENERAL");
    expect(listed).not.toContain("C-THEIRS");

    expect(await h.post("hi", { conversationId: "C-GENERAL" })).toMatchObject({
      ok: true,
    });
    expect(await h.post("leak", { conversationId: "C-THEIRS" })).toMatchObject({
      error: expect.stringContaining("owner is not a member"),
    });
    expect(h.messages()).toMatchObject([{ channel: "C-GENERAL" }]);
  });
});

describe("slack outbound — a direct message stays within reach (#5509)", () => {
  const channels: FakeSlackChannel[] = [
    {
      id: BOUND,
      name: "agent-home",
      botIsMember: true,
      members: ["UOWNER", "UTEAMMATE"],
    },
    {
      id: "C-THEIRS",
      name: "their-team",
      botIsMember: true,
      members: ["USTRANGER"],
    },
  ];

  /**
   * TEST_SCENARIO: The shared bot can open a DM with anyone in the
   * workspace. An agent may message directly only its owner and the people
   * in a conversation it is connected to — by user id or by DM id alike —
   * and no DM is opened with anyone else.
   */
  it("messages the owner and a member of a bound conversation, and refuses a stranger", async () => {
    const h = harness({
      boundChannelId: BOUND,
      channels,
      ownerSlackUsers: ["UOWNER"],
    });
    expect(await h.post("hi", { conversationId: "UOWNER" })).toMatchObject({
      ok: true,
    });
    expect(await h.post("hi", { conversationId: "UTEAMMATE" })).toMatchObject({
      ok: true,
    });
    for (const conversationId of ["USTRANGER", "D-USTRANGER"]) {
      expect(await h.post("hello", { conversationId })).toMatchObject({
        error: expect.stringContaining("USTRANGER is not your owner"),
      });
    }
    expect(h.messages()).toMatchObject([
      { channel: "D-UOWNER" },
      { channel: "D-UTEAMMATE" },
    ]);
  });

  it("messages the person on the other end of a bound DM", async () => {
    const h = harness({
      boundChannelId: BOUND,
      extraBoundChannelIds: ["D-UFRIEND"],
      channels,
    });
    expect(await h.post("hi", { conversationId: "UFRIEND" })).toMatchObject({
      ok: true,
    });
    expect(h.messages()).toMatchObject([{ channel: "D-UFRIEND" }]);
  });

  it("an owner with no linked Slack identity reaches only members of bound conversations", async () => {
    const h = harness({ boundChannelId: BOUND, channels, ownerSlackUsers: [] });
    expect(await h.post("hi", { conversationId: "UTEAMMATE" })).toMatchObject({
      ok: true,
    });
    expect(
      await h.post("hello", { conversationId: "USTRANGER" }),
    ).toMatchObject({ error: expect.stringContaining("is not your owner") });
  });
});

describe("slack outbound — a private artifact's link", () => {
  const PRIVATE = "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
  const PUBLIC = "0b6f6a52-5d0e-4a4e-9b1e-1f0c2a3b4c5d";
  const artifacts: StubArtifact[] = [
    { id: PRIVATE, title: "Draft plan", shareUrl: null },
    {
      id: PUBLIC,
      title: "Weekly report",
      shareUrl: "https://share.example/a/weekly-report",
    },
  ];
  const APP_URL = `http://ui/artifacts/${PRIVATE}`;
  const OWNER_DM = `D-${OWNER_SLACK}`;
  const groupDm: FakeSlackChannel = {
    id: "G-GROUP",
    name: "group",
    botIsMember: true,
    isGroupDirectMessage: true,
  };

  const refused = {
    error: expect.stringContaining("must be shared from the app"),
  };

  /**
   * TEST_SCENARIO: A private artifact's link may reach Slack only in the 1:1 DM
   * between the bot and the artifact's owner. The worker resolves the
   * conversation once and applies the rule to that same conversation, so the
   * bound owner DM posts the app's own address, a DM with anyone else, a group
   * DM and a channel all keep the refusal, and a public artifact keeps its
   * share URL.
   */
  it("posts the app's address into the owner's DM and refuses everywhere else", async () => {
    const dm = harness({
      boundChannelId: OWNER_DM,
      channels: [],
      artifacts,
    });
    expect(
      await dm.post(`Draft: platform://artifacts/${PRIVATE}`),
    ).toMatchObject({ ok: true, conversationId: OWNER_DM });
    expect(dm.messages()).toMatchObject([
      { channel: OWNER_DM, text: signed(`Draft: ${APP_URL}`) },
    ]);

    for (const opts of [
      { boundChannelId: "D-USTAFF", channels: [] },
      { boundChannelId: groupDm.id, channels: [groupDm] },
      { boundChannelId: BOUND, channels: workspace },
    ]) {
      const h = harness({ ...opts, artifacts });
      expect(
        await h.post(`Draft: platform://artifacts/${PRIVATE}`),
      ).toMatchObject(refused);
      expect(h.messages()).toEqual([]);
    }

    const publicOne = harness({
      boundChannelId: BOUND,
      channels: workspace,
      artifacts,
    });
    await publicOne.post(`Report: platform://artifacts/${PUBLIC}`);
    expect(publicOne.messages()).toMatchObject([
      { text: signed("Report: https://share.example/a/weekly-report") },
    ]);
  });

  /**
   * TEST_SCENARIO: A user id names the DM with that person, so opening the
   * owner's DM by id keeps the exception, while the same link to a member of a
   * bound channel is refused.
   */
  it("reads a user id as the DM with that person", async () => {
    const owner = harness({
      boundChannelId: BOUND,
      channels: workspace,
      artifacts,
      ownerSlackUsers: ["UOWNER"],
      ownerSlackLinks: [{ id: "UOWNER", teamId: "" }],
    });
    expect(
      await owner.post(`Draft: platform://artifacts/${PRIVATE}`, {
        conversationId: "UOWNER",
      }),
    ).toMatchObject({ ok: true, conversationId: "D-UOWNER" });
    expect(owner.messages()).toMatchObject([
      { channel: "D-UOWNER", text: signed(`Draft: ${APP_URL}`) },
    ]);

    const teammate = harness({
      boundChannelId: BOUND,
      extraBoundChannelIds: ["D-USTAFF"],
      channels: workspace,
      artifacts,
    });
    expect(
      await teammate.post(`Draft: platform://artifacts/${PRIVATE}`, {
        conversationId: "USTAFF",
      }),
    ).toMatchObject(refused);
    expect(teammate.messages()).toEqual([]);
  });

  /**
   * TEST_SCENARIO: A card holds links too, and it travels to the same target as
   * the text: refused with the text in a channel, rewritten in the owner's DM.
   */
  it("applies the rule to a card's links", async () => {
    const card = {
      card: {
        type: "card" as const,
        title: "Draft",
        children: [
          {
            type: "actions" as const,
            children: [
              {
                type: "link-button" as const,
                label: "Open",
                url: `platform://artifacts/${PRIVATE}`,
              },
            ],
          },
        ],
      },
      text: "Draft",
    };
    const channel = harness({
      boundChannelId: BOUND,
      channels: workspace,
      artifacts,
    });
    expect(await channel.post("Draft", { card })).toMatchObject(refused);
    expect(channel.messages()).toEqual([]);

    const dm = harness({ boundChannelId: OWNER_DM, channels: [], artifacts });
    const sent = vi.spyOn(dm.gw, "postMessage");
    expect(await dm.post("Draft", { card })).toMatchObject({ ok: true });
    expect(JSON.stringify(sent.mock.calls[0]![0].blocks)).toContain(APP_URL);
  });

  /**
   * TEST_SCENARIO: A reply lands in the thread it names, in the conversation
   * that thread is in, so a reply into the owner's DM keeps the exception.
   */
  it("posts the app's address in a reply into the owner's DM", async () => {
    const h = harness({
      boundChannelId: BOUND,
      channels: workspace,
      artifacts,
    });
    await h.worker.start("agent-1");

    expect(
      await h.worker.reply("agent-1", {
        text: `Draft: platform://artifacts/${PRIVATE}`,
        conversationId: OWNER_DM,
        threadTs: "1700000000.000100",
      }),
    ).toMatchObject({ ok: true, conversationId: OWNER_DM });
    expect(h.messages()).toMatchObject([
      {
        channel: OWNER_DM,
        threadTs: "1700000000.000100",
        text: signed(`Draft: ${APP_URL}`),
      },
    ]);
  });

  /**
   * TEST_SCENARIO: A card is checked against its limits once more after its
   * links are rewritten, because a rewritten link can be longer than the one
   * the agent wrote: a title that fitted before can overflow Slack's, and a
   * card Slack would cut is refused instead, with nothing posted.
   */
  it("refuses a card its rewritten links push past the card limits", async () => {
    const id = PRIVATE;
    const link = `platform://artifacts/${id}`;
    const title = `${"x".repeat(145 - link.length)}${link}`;
    const card = {
      card: {
        type: "card" as const,
        title,
        children: [{ type: "text" as const, content: "Draft" }],
      },
      text: "Draft",
    };
    expect(title).toHaveLength(145);

    const h = harness({
      boundChannelId: OWNER_DM,
      channels: [],
      artifacts,
      linkArtifacts: artifactLinks(artifacts, "https://dam.example.com"),
    });
    expect(await h.post("Draft", { card })).toMatchObject({
      error: expect.stringContaining("the card title holds"),
    });
    expect(h.messages()).toEqual([]);
  });

  /**
   * TEST_SCENARIO: The binding can change between the moment a send resolves its
   * conversation and the moment the message goes out. The send keeps the
   * conversation it resolved, so a rewritten private link can never follow a
   * replacement channel.
   */
  it("sends to the conversation it resolved, whatever the bindings say next", async () => {
    let replaced = false;
    const h = harness({
      boundChannelId: OWNER_DM,
      channels: [],
      artifacts,
      linkArtifacts: (input) => {
        replaced = true;
        h.registry.resolveSlackChannelsByInstance = async () => [
          { id: "C-REPLACED", teamId: "" },
        ];
        return artifactLinks(artifacts)(input);
      },
    });

    expect(
      await h.post(`Draft: platform://artifacts/${PRIVATE}`),
    ).toMatchObject({ ok: true, conversationId: OWNER_DM });
    expect(h.messages()).toMatchObject([
      { channel: OWNER_DM, text: signed(`Draft: ${APP_URL}`) },
    ]);
    expect(replaced).toBe(true);
    expect(h.messages().map((m) => m.channel)).not.toContain("C-REPLACED");
  });

  /**
   * TEST_SCENARIO: One owner may link several Slack accounts in one workspace,
   * and the identity rows come back in no order: every one of them is proof,
   * while a link in another workspace, and the legacy link with no workspace,
   * prove nothing for a conversation in this one.
   */
  it("takes every exact-workspace owner account as proof, and only those", async () => {
    for (const links of [
      [
        { id: "U-ONE", teamId: "" },
        { id: OWNER_SLACK, teamId: "" },
      ],
      [
        { id: OWNER_SLACK, teamId: "" },
        { id: "U-ONE", teamId: "" },
      ],
    ]) {
      const h = harness({
        boundChannelId: OWNER_DM,
        channels: [],
        artifacts,
        ownerSlackLinks: links,
      });
      expect(
        await h.post(`Draft: platform://artifacts/${PRIVATE}`),
      ).toMatchObject({ ok: true });
    }

    for (const opts of [
      { ownerSlackLinks: [{ id: OWNER_SLACK, teamId: "T-ELSEWHERE" }] },
      {
        ownerSlackLinks: [{ id: OWNER_SLACK, teamId: null }],
        workspaces: [""],
      },
      {
        ownerSlackLinks: [{ id: OWNER_SLACK, teamId: null }],
        workspaces: ["", "T-SECOND"],
      },
    ]) {
      const h = harness({
        boundChannelId: OWNER_DM,
        channels: [],
        artifacts,
        ...opts,
      });
      expect(
        await h.post(`Draft: platform://artifacts/${PRIVATE}`),
      ).toMatchObject(refused);
    }

    const enterprise = harness({
      boundChannelId: "D-W-OWNER",
      channels: [],
      artifacts,
      ownerSlackLinks: [{ id: "W-OWNER", teamId: "" }],
    });
    expect(
      await enterprise.post(`Draft: platform://artifacts/${PRIVATE}`),
    ).toMatchObject({ ok: true });
  });

  /**
   * TEST_SCENARIO: An ordinary message costs nothing extra: with no artifact
   * reference in it the rule never runs, so the destination is never asked
   * about and the owner's identity is never read. A message that does carry a
   * reference asks both once.
   */
  it("asks the destination only when a message names an artifact", async () => {
    const linker = vi.fn(artifactLinks(artifacts));
    const h = harness({
      boundChannelId: BOUND,
      channels: workspace,
      artifacts,
      linkArtifacts: linker,
    });
    const lookups = vi.spyOn(h.gw, "getConversationInfo");

    await h.post("no artifact here");

    expect(linker).not.toHaveBeenCalled();
    expect(lookups).not.toHaveBeenCalled();

    await h.post(`Draft: platform://artifacts/${PRIVATE}`);

    expect(linker).toHaveBeenCalledTimes(1);
    expect(lookups).toHaveBeenCalled();
  });

  /**
   * TEST_SCENARIO: The owner's Slack identity is the proof that the DM's other
   * end is them. When those rows cannot be read, nothing was proved, so the
   * private link is refused rather than posted.
   */
  it("fails closed when the owner's identity links cannot be read", async () => {
    const h = harness({
      boundChannelId: OWNER_DM,
      channels: [],
      artifacts,
      identityLinksFail: true,
    });

    expect(
      await h.post(`Draft: platform://artifacts/${PRIVATE}`),
    ).toMatchObject(refused);
    expect(h.messages()).toEqual([]);
  });
});
