// TEST_OVERVIEW: the tool mode and the tool list of an MCP Connection. A Slack Account is read only unless the create names another mode, and its owner switches it with one verb. The Templates that make an MCP Connection list the modes they offer, so a client shows the picker only there. Every MCP Connection with a Secret offers all three modes, and its Secret tells the gateway to send request bodies on its MCP host to the check; one with no auth offers allow all alone. The api-server reads the server's tool list with the Connection's own credential, at create, when a new credential replaces the old one, and on refresh, and stores which tools read: the server's `readOnlyHint`, or the Template's own read list where it declares one. A list that fails never fails the create. When a call of a Slack Account that writes a message is held, the api-server names where the message goes with the Connection's own token: the channel, or the person of a direct message; any other call, or a Slack answer that is not ok, gets no name. The listing shows the mode on MCP Connections only, and needs approval is open only to an owner with the feature on. Setting the mode clears the tool access of every grant of the Connection, so every Agent follows the mode again.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Connection, ToolMode } from "api-server-api";
import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import { createConnectionTemplateRegistry } from "../../modules/connections/domain/connection-template.js";
import { toolAccessFor } from "../../modules/connections/domain/tool-access.js";
import { createToolCallLabels } from "../../modules/connections/services/tool-call-labels.js";
import type { SecretStore } from "../../modules/secret-store/index.js";
import {
  fakeMcpToolLister,
  serviceHarness,
  type FakeMcpToolLister,
} from "../helpers/connections-service.js";

const templates = createConnectionTemplateRegistry(
  buildCatalog({
    slack: { clientId: "slack-client", clientSecret: "shh" },
    github: { clientId: "Iv1.client", clientSecret: "shh" },
  }),
);

const HOSTS_ANNOTATION = "agent-platform.ai/injection-hosts";

function harness(
  opts: { toolApproval?: boolean; lister?: FakeMcpToolLister } = {},
) {
  return serviceHarness({
    templates,
    brandName: "Platform",
    toolApprovalOffered: async () => opts.toolApproval ?? true,
    mcpToolLister: opts.lister ?? fakeMcpToolLister(),
  });
}

function secretPathOf(connection: Connection): string {
  if (connection.auth.kind === "oauth")
    return connection.auth.accessTokenRef.path;
  if (connection.auth.kind === "header") return connection.auth.valueRef.path;
  throw new Error(`no Secret on a ${connection.auth.kind} auth`);
}

function hostEntries(
  secrets: ReturnType<typeof harness>["secrets"],
  connection: Connection,
): { host: string; checkBody?: boolean }[] {
  return JSON.parse(
    secrets.get(secretPathOf(connection))!.annotations[HOSTS_ANNOTATION]!,
  );
}

async function connectCustomMcp(
  h: ReturnType<typeof harness>,
): Promise<Connection> {
  const id = await h.svc.createFromTemplate({
    templateId: "custom-mcp-none",
    authKind: "none",
    name: "my-notes",
    url: "https://mcp.example.com/mcp",
    headerName: "X-Api-Key",
    value: "notes-key",
  });
  return h.rows.get(id)!;
}

const NOTES_TOOLS = [
  { name: "notes_search", readOnly: true },
  { name: "notes_write", readOnly: false },
];

async function connectSlack(
  h: ReturnType<typeof harness>,
  toolMode?: ToolMode,
): Promise<Connection> {
  const id = await h.svc.createFromTemplate({
    templateId: "slack",
    authKind: "oauth",
    name: "my-slack",
    ...(toolMode === undefined ? {} : { toolMode }),
  });
  return h.rows.get(id)!;
}

describe("the tool mode of a Slack Account Connection", () => {
  // TEST_SCENARIO: the owner connects Slack and names no mode. Posting as the owner must be a choice, so the new Connection is read only, its listing offers all three modes with read only as the Template's default, and its Secret asks the gateway for request bodies on Slack's MCP host.
  it("makes a new Connection read only", async () => {
    const h = harness();
    const created = await connectSlack(h);
    expect(created.auth).not.toHaveProperty("fullAccess");
    expect(created.toolAccess?.mode).toBe("read-only");
    const view = await h.svc.getConnection(created.id);
    expect(view?.fullAccess).toBeUndefined();
    expect(view?.toolAccess).toEqual({
      mode: "read-only",
      modes: ["allow-all", "read-only", "needs-approval"],
      defaultMode: "read-only",
      tools: null,
      listedAt: null,
      listError: null,
    });
    expect(hostEntries(h.secrets, created)).toEqual([
      expect.objectContaining({ host: "mcp.slack.com", checkBody: true }),
    ]);
  });

  // TEST_SCENARIO: the owner connects Slack and names allow all. The Connection stores the mode in its own column, not as a flag on its auth or in its recorded inputs, and the listing says allow all without GitHub's full access.
  it("stores the mode the create names", async () => {
    const h = harness();
    const created = await connectSlack(h, "allow-all");
    expect(created.toolAccess?.mode).toBe("allow-all");
    expect(created.auth).not.toHaveProperty("fullAccess");
    expect(created.inputs).not.toHaveProperty("toolMode");
    const view = await h.svc.getConnection(created.id);
    expect(view?.toolAccess?.mode).toBe("allow-all");
    expect(view?.fullAccess).toBeUndefined();
  });

  // TEST_SCENARIO: the owner changes their mind in both directions. Setting the mode writes only the mode, and the rest of the Connection stays.
  it("switches between allow all and read only", async () => {
    const h = harness();
    const created = await connectSlack(h);
    await h.svc.setToolMode({ id: created.id, mode: "allow-all" });
    expect(h.rows.get(created.id)).toEqual({
      ...created,
      toolAccess: { ...created.toolAccess, mode: "allow-all" },
    });
    await h.svc.setToolMode({ id: created.id, mode: "read-only" });
    expect(h.rows.get(created.id)).toEqual(created);
  });

  // TEST_SCENARIO: needs approval is an experimental mode. With the feature off for the owner it is refused, at create and later, and the mode stays; with it on it is stored.
  it("sets needs approval only with the feature on", async () => {
    const off = harness({ toolApproval: false });
    await expect(connectSlack(off, "needs-approval")).rejects.toThrow(
      /experimental feature/,
    );
    expect(off.rows.size).toBe(0);
    const refused = await connectSlack(off);
    await expect(
      off.svc.setToolMode({ id: refused.id, mode: "needs-approval" }),
    ).rejects.toThrow(/experimental feature/);
    expect(off.rows.get(refused.id)!.toolAccess?.mode).toBe("read-only");
    await off.svc.setToolMode({ id: refused.id, mode: "allow-all" });
    expect(off.rows.get(refused.id)!.toolAccess?.mode).toBe("allow-all");

    const on = harness({ toolApproval: true });
    const created = await connectSlack(on, "needs-approval");
    expect(on.rows.get(created.id)!.toolAccess?.mode).toBe("needs-approval");
    const view = await on.svc.getConnection(created.id);
    expect(view?.toolAccess?.mode).toBe("needs-approval");
  });

  // TEST_SCENARIO: the Slack choice between read only and "Can post as me" stays one choice for the whole Connection. Setting the mode clears the access each grant stores, so every Agent that holds the Connection follows the new mode.
  it("clears the access of every grant when the mode changes", async () => {
    const h = harness();
    const created = await connectSlack(h);
    await h.svc.setAgentConnections("agent-1", [created.id]);
    await h.svc.setAgentConnections("agent-2", [created.id]);
    await h.svc.setGrantToolAccess({
      agentId: "agent-1",
      connectionId: created.id,
      access: { read: "allow", write: "ask", overrides: {} },
    });
    await h.svc.setToolMode({ id: created.id, mode: "allow-all" });
    expect(h.grantAccess.get(`${created.id}|agent-1`)).toBeNull();
    expect(h.grantAccess.get(`${created.id}|agent-2`)).toBeNull();
    for (const agentId of ["agent-1", "agent-2"]) {
      const listed = await h.svc.getAgentConnections(agentId);
      expect(listed.connections[0]?.toolAccess).toEqual({
        read: "allow",
        write: "allow",
        overrides: {},
      });
    }
  });

  // TEST_SCENARIO: a Connection made before tool access existed has a Secret that does not ask for request bodies, so its gateway sends none and the gate would refuse every call of a read-only Connection. Switching it to read only writes the Secret again with the flag, and keeps its fields.
  it("writes the body check on an older Secret when it turns read only", async () => {
    const h = harness();
    const created = await connectSlack(h, "allow-all");
    if (created.auth.kind !== "oauth") throw new Error("not an OAuth auth");
    const path = created.auth.accessTokenRef.path;
    const stored = h.secrets.get(path)!;
    h.secrets.set(path, {
      ...stored,
      fields: { ...stored.fields, access_token: "xoxp-real" },
      annotations: {
        [HOSTS_ANNOTATION]: JSON.stringify(
          hostEntries(h.secrets, created).map(({ checkBody: _, ...e }) => e),
        ),
      },
    });
    await h.svc.setToolMode({ id: created.id, mode: "read-only" });
    expect(hostEntries(h.secrets, created)[0]).toMatchObject({
      checkBody: true,
    });
    expect(h.secrets.get(path)!.fields.access_token).toBe("xoxp-real");
  });

  // TEST_SCENARIO: only an MCP Connection has a tool mode. Naming one at create on a Template with no MCP server, or setting one on a Connection that does not exist, is refused instead of stored as a mode that limits nothing.
  it("refuses a mode where there is no MCP server", async () => {
    const h = harness();
    await expect(
      h.svc.createFromTemplate({
        templateId: "github",
        authKind: "oauth",
        name: "my-github",
        toolMode: "read-only",
      }),
    ).rejects.toThrow(/does not offer/);
    await expect(
      h.svc.setToolMode({ id: "conn-missing", mode: "allow-all" }),
    ).rejects.toThrow(/not found/);
  });

  // TEST_SCENARIO: a client shows the mode picker at connect only for a Template that makes an MCP Connection, with that Template's default first chosen: read only for Slack, allow all elsewhere, and allow all alone for an MCP server with no auth.
  it("lists the modes on the Templates that make an MCP Connection", async () => {
    const h = harness();
    const listed = await h.svc.listTemplates();
    const offered = Object.fromEntries(
      listed.flatMap((t) => (t.toolAccess ? [[t.id, t.toolAccess]] : [])),
    );
    const all = ["allow-all", "read-only", "needs-approval"];
    expect(offered.slack).toEqual({ defaultMode: "read-only", modes: all });
    expect(offered["custom-mcp-oauth"]).toEqual({
      defaultMode: "allow-all",
      modes: all,
    });
    expect(offered["custom-mcp-none"]).toEqual({
      defaultMode: "allow-all",
      modes: ["allow-all"],
    });
    expect(offered).not.toHaveProperty("github");
  });
});

describe("the tool list of an MCP Connection", () => {
  // TEST_SCENARIO: the owner connects a custom MCP server with a header credential. The api-server reads its tools with that credential, and stores which ones read from the server's hints. The Connection offers all three modes, and its Secret asks the gateway for request bodies on the MCP host, while a Connection with no MCP server asks for none.
  it("reads the tools at create with the Connection's own credential", async () => {
    const lister = fakeMcpToolLister({ ok: true, tools: NOTES_TOOLS });
    const h = harness({ lister });
    const created = await connectCustomMcp(h);
    expect(lister.calls).toEqual([
      {
        url: "https://mcp.example.com/mcp",
        headers: { "X-Api-Key": "notes-key" },
      },
    ]);
    const view = await h.svc.getConnection(created.id);
    expect(view?.toolAccess).toEqual({
      mode: "allow-all",
      modes: ["allow-all", "read-only", "needs-approval"],
      defaultMode: "allow-all",
      tools: NOTES_TOOLS,
      listedAt: expect.any(String),
      listError: null,
    });
    expect(hostEntries(h.secrets, created)).toEqual([
      expect.objectContaining({ host: "mcp.example.com", checkBody: true }),
    ]);

    const header = await h.svc.createFromTemplate({
      templateId: "custom-header",
      authKind: "header",
      name: "my-api",
      host: "api.example.com",
      headerName: "X-Api-Key",
      value: "secret",
    });
    expect(hostEntries(h.secrets, h.rows.get(header)!)).toEqual([
      expect.not.objectContaining({ checkBody: true }),
    ]);
    expect(lister.calls).toHaveLength(1);
  });

  // TEST_SCENARIO: the server cannot be read at create. The Connection still works without its list, so the create goes on and the reason is stored for the owner. A refresh that works stores the tools and clears the reason; a later refresh that fails keeps the tools it had.
  it("keeps the Connection when the list fails, and refreshes it later", async () => {
    const lister = fakeMcpToolLister({
      ok: false,
      reason: "the server answered HTTP 401",
    });
    const h = harness({ lister });
    const created = await connectCustomMcp(h);
    expect(h.rows.get(created.id)?.toolAccess).toEqual({
      mode: "allow-all",
      tools: null,
      listedAt: null,
      listError: "the server answered HTTP 401",
    });

    lister.answer = { ok: true, tools: NOTES_TOOLS };
    const refreshed = await h.svc.refreshTools({ id: created.id });
    expect(refreshed).toMatchObject({ tools: NOTES_TOOLS, listError: null });
    expect(refreshed.listedAt).not.toBeNull();

    lister.answer = { ok: false, reason: "timed out after 15 s" };
    expect(await h.svc.refreshTools({ id: created.id })).toEqual({
      ...refreshed,
      listError: "timed out after 15 s",
    });
  });

  // TEST_SCENARIO: the credential that read the list at create no longer works, so the list failed, and the owner puts in a new one later. Read only refuses every tool the list does not name, so the api-server reads the list again with the new credential, without waiting for a refresh by hand. A list that fails then does not fail the update.
  it("reads the tools again when a new credential replaces the old one", async () => {
    const lister = fakeMcpToolLister({
      ok: false,
      reason: "the server answered HTTP 401",
    });
    const h = harness({ lister });
    const created = await connectCustomMcp(h);

    lister.answer = { ok: true, tools: NOTES_TOOLS };
    await h.svc.update(created.id, { value: "new-key" });
    expect(lister.calls.at(-1)?.headers).toEqual({ "X-Api-Key": "new-key" });
    expect(h.rows.get(created.id)?.toolAccess).toMatchObject({
      tools: NOTES_TOOLS,
      listError: null,
    });

    lister.answer = { ok: false, reason: "timed out after 15 s" };
    await h.svc.update(created.id, { value: "newer-key" });
    expect(h.rows.get(created.id)?.toolAccess).toMatchObject({
      tools: NOTES_TOOLS,
      listError: "timed out after 15 s",
    });
  });

  // TEST_SCENARIO: Slack's server sets its own hints, but the Template's read list is what the gateway enforces. The stored tools must say the same, so the owner sees the tools that really pass in read only.
  it("stores the Template's read list over the server's hints on a Slack Account", async () => {
    const readTool = templates.get("slack")!.toolAccess!.readTools[0]!;
    const lister = fakeMcpToolLister({
      ok: true,
      tools: [
        { name: readTool, readOnly: false },
        { name: "slack_send_message", readOnly: true },
      ],
    });
    const h = harness({ lister });
    const created = await connectSlack(h);
    expect(lister.calls).toHaveLength(0);
    const path = secretPathOf(created);
    h.secrets.set(path, {
      ...h.secrets.get(path)!,
      fields: { ...h.secrets.get(path)!.fields, access_token: "xoxp-real" },
    });
    const refreshed = await h.svc.refreshTools({ id: created.id });
    expect(lister.calls[0]?.headers).toEqual({
      Authorization: "Bearer xoxp-real",
    });
    expect(refreshed.tools).toEqual([
      { name: readTool, readOnly: true },
      { name: "slack_send_message", readOnly: false },
    ]);
  });

  // TEST_SCENARIO: the owner sets a custom MCP Connection to read only, and the Agent's grant stores no access of its own. The gate's limit on its MCP host allows only the tools the stored list marks as reading, and blocks a write tool and a tool the list does not name.
  it("limits a read-only custom MCP Connection to its read tools", async () => {
    const h = harness({
      lister: fakeMcpToolLister({ ok: true, tools: NOTES_TOOLS }),
    });
    const created = await connectCustomMcp(h);
    await h.svc.setToolMode({ id: created.id, mode: "read-only" });
    const granted = [{ connection: h.rows.get(created.id)!, toolAccess: null }];
    const limit = toolAccessFor(granted, (id) => templates.get(id), {
      host: "mcp.example.com",
      connectionId: null,
    });
    expect(limit).toMatchObject({ connectionId: created.id });
    expect(limit?.ruleOf("notes_search").rule).toBe("allow");
    expect(limit?.ruleOf("notes_write").rule).toBe("block");
    expect(limit?.ruleOf("notes_new_tool").rule).toBe("block");
    expect(
      toolAccessFor(granted, (id) => templates.get(id), {
        host: "api.example.com",
        connectionId: null,
      }),
    ).toBeNull();
  });
});

describe("the tool mode of other Connections", () => {
  // TEST_SCENARIO: a custom MCP server with no auth has no Secret, so its traffic passes the gateway unread. Its listing shows allow all as the only mode, a stricter mode is refused, nothing reads its tools, and a Connection with no MCP server shows no mode at all.
  it("offers allow all alone on an MCP Connection with no auth, and nothing elsewhere", async () => {
    const lister = fakeMcpToolLister();
    const h = harness({ lister });
    const mcp = await h.svc.createFromTemplate({
      templateId: "custom-mcp-none",
      authKind: "none",
      name: "my-mcp",
      url: "https://mcp.example.com/mcp",
    });
    const header = await h.svc.createFromTemplate({
      templateId: "custom-header",
      authKind: "header",
      name: "my-api",
      host: "api.example.com",
      headerName: "X-Api-Key",
      value: "secret",
    });
    const listed = await h.svc.listConnections();
    expect(listed.find((c) => c.id === mcp)?.toolAccess).toEqual({
      mode: "allow-all",
      modes: ["allow-all"],
      defaultMode: "allow-all",
      tools: null,
      listedAt: null,
      listError: null,
    });
    expect(listed.find((c) => c.id === header)).not.toHaveProperty(
      "toolAccess",
    );
    await expect(
      h.svc.setToolMode({ id: mcp, mode: "read-only" }),
    ).rejects.toThrow(/does not offer/);
    await expect(
      h.svc.setToolMode({ id: header, mode: "allow-all" }),
    ).rejects.toThrow(/does not offer/);
    expect(lister.calls).toEqual([]);
  });
});

describe("the target name of a held Slack call", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const slackConnection = {
    id: "conn-slack",
    ownerId: "user-1",
    templateId: "slack",
    name: "my-slack",
    inputs: {},
    auth: {
      kind: "oauth",
      clientId: "slack-client",
      scopes: [],
      accessTokenRef: { storeId: "test", path: "slack", field: "access_token" },
    },
    contributions: [],
  } as unknown as Connection;

  function labels() {
    const reads: string[] = [];
    return {
      reads,
      labels: createToolCallLabels({
        repo: {
          getById: async (id) => {
            reads.push(id);
            return id === slackConnection.id ? slackConnection : null;
          },
        },
        secretStore: {
          getField: async () => "xoxp-token",
        } as unknown as SecretStore,
      }),
    };
  }

  function slackApi(answers: Record<string, unknown>) {
    const asked: { url: string; auth: string | null }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const href = String(url);
        asked.push({
          url: href,
          auth: new Headers(init?.headers).get("authorization"),
        });
        const answer = answers[href.replace("https://slack.com/api/", "")];
        if (answer === undefined) throw new Error(`unexpected fetch ${href}`);
        return new Response(JSON.stringify(answer), {
          headers: { "content-type": "application/json" },
        });
      }),
    );
    return asked;
  }

  const send = (channelId: string, tool = "slack_send_message") => ({
    connectionId: slackConnection.id,
    templateId: "slack",
    tool,
    arguments: { channel_id: channelId, message: "hi" },
  });

  const signal = new AbortController().signal;

  // TEST_SCENARIO: the agent posts to a channel. The approval shows the channel by its name, which Slack gives for the conversation id when asked with the person's own token.
  it("names a channel", async () => {
    const asked = slackApi({
      "conversations.info?channel=C0CL63K6FKL": {
        ok: true,
        channel: { name: "general" },
      },
    });
    expect(await labels().labels.targetLabel(send("C0CL63K6FKL"), signal)).toBe(
      "#general",
    );
    expect(asked).toEqual([
      {
        url: "https://slack.com/api/conversations.info?channel=C0CL63K6FKL",
        auth: "Bearer xoxp-token",
      },
    ]);
  });

  // TEST_SCENARIO: the agent writes to a direct message, by its conversation id or by the person's id. Both show the person's display name, or their real name when they set no display name.
  it("names the person of a direct message", async () => {
    slackApi({
      "conversations.info?channel=D0DM": {
        ok: true,
        channel: { is_im: true, user: "U0JANE" },
      },
      "users.info?user=U0JANE": {
        ok: true,
        user: { profile: { display_name: "", real_name: "Jane Doe" } },
      },
      "users.info?user=W0JOE": {
        ok: true,
        user: { profile: { display_name: "joe", real_name: "Joe Bloggs" } },
      },
    });
    const { labels: l } = labels();
    expect(await l.targetLabel(send("D0DM"), signal)).toBe("Jane Doe");
    expect(
      await l.targetLabel(send("W0JOE", "slack_schedule_message"), signal),
    ).toBe("joe");
  });

  // TEST_SCENARIO: a group direct message has no name a person would know, and Slack can refuse the lookup. Neither gets a name, so the approval shows the id.
  it("gives no name to a group message or a refused lookup", async () => {
    slackApi({
      "conversations.info?channel=G0MPIM": {
        ok: true,
        channel: { is_mpim: true, name: "mpdm-jane--joe-1" },
      },
      "conversations.info?channel=C0SECRET": {
        ok: false,
        error: "channel_not_found",
      },
    });
    const { labels: l } = labels();
    expect(await l.targetLabel(send("G0MPIM"), signal)).toBeNull();
    expect(await l.targetLabel(send("C0SECRET"), signal)).toBeNull();
  });

  // TEST_SCENARIO: a call that sends no message, a call with an id in no Slack shape, and a call of another Template have no target to name. Nothing is asked of Slack, and the Connection's Secret is not read.
  it("asks nothing for a call it does not name", async () => {
    const asked = slackApi({});
    const { labels: l, reads } = labels();
    expect(
      await l.targetLabel(
        { ...send("C0CL63K6FKL"), tool: "slack_read_channel" },
        signal,
      ),
    ).toBeNull();
    expect(await l.targetLabel(send("general&x=1"), signal)).toBeNull();
    expect(
      await l.targetLabel(
        { ...send("C0CL63K6FKL"), templateId: "notes" },
        signal,
      ),
    ).toBeNull();
    expect(asked).toEqual([]);
    expect(reads).toEqual([]);
  });
});
