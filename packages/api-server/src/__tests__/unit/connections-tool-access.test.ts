// TEST_OVERVIEW: the tool mode and the tool list of an MCP Connection. A Slack Account is read only unless the create names full access, and its owner switches it with one verb; the older read-only / full-access verb maps onto the mode. Every MCP Connection with a Secret offers all three modes, and its Secret tells the gateway to send request bodies on its MCP host to the check; one with no auth offers allow all alone. The api-server reads the server's tool list with the Connection's own credential, at create and on refresh, and stores which tools read: the server's `readOnlyHint`, or the Template's own read list where it declares one. A list that fails never fails the create. The listing shows the mode on MCP Connections only, and needs approval is open only to an owner with the feature on.
import { describe, expect, it } from "vitest";
import type { Connection } from "api-server-api";
import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import { createConnectionTemplateRegistry } from "../../modules/connections/domain/connection-template.js";
import { toolAccessFor } from "../../modules/connections/domain/tool-access.js";
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
  fullAccess?: boolean,
): Promise<Connection> {
  const id = await h.svc.createFromTemplate({
    templateId: "slack",
    authKind: "oauth",
    name: "my-slack",
    ...(fullAccess === undefined ? {} : { fullAccess }),
  });
  return h.rows.get(id)!;
}

describe("the tool mode of a Slack Account Connection", () => {
  // TEST_SCENARIO: the owner connects Slack and names no access. Posting as the owner must be a choice, so the new Connection is read only, its listing offers the choice under the Template's own label and all three modes, and its Secret asks the gateway for request bodies on Slack's MCP host.
  it("makes a new Connection read only", async () => {
    const h = harness();
    const created = await connectSlack(h);
    expect(created.auth).not.toHaveProperty("fullAccess");
    expect(created.toolAccess?.mode).toBe("read-only");
    const view = await h.svc.getConnection(created.id);
    expect(view?.fullAccess).toBeUndefined();
    expect(view?.accessChoice).toEqual({ fullAccessLabel: "Can post as me" });
    expect(view?.toolAccess).toEqual({
      mode: "read-only",
      modes: ["allow-all", "read-only", "needs-approval"],
      tools: null,
      listedAt: null,
      listError: null,
    });
    expect(hostEntries(h.secrets, created)).toEqual([
      expect.objectContaining({ host: "mcp.slack.com", checkBody: true }),
    ]);
  });

  // TEST_SCENARIO: the owner connects Slack and names full access. The Connection stores allow all as its mode, not a flag on its auth or in its recorded inputs, and the listing still says full access for a client that knows only that choice.
  it("allows all when the create names full access", async () => {
    const h = harness();
    const created = await connectSlack(h, true);
    expect(created.toolAccess?.mode).toBe("allow-all");
    expect(created.auth).not.toHaveProperty("fullAccess");
    expect(created.inputs).not.toHaveProperty("fullAccess");
    expect((await h.svc.getConnection(created.id))?.fullAccess).toBe(true);
  });

  // TEST_SCENARIO: the owner changes their mind in both directions with the older verb. It writes the mode, and the rest of the Connection stays.
  it("maps full access and read only onto the mode", async () => {
    const h = harness();
    const created = await connectSlack(h);
    await h.svc.setFullAccess({ id: created.id, fullAccess: true });
    expect(h.rows.get(created.id)).toEqual({
      ...created,
      toolAccess: { ...created.toolAccess, mode: "allow-all" },
    });
    await h.svc.setFullAccess({ id: created.id, fullAccess: false });
    expect(h.rows.get(created.id)).toEqual(created);
  });

  // TEST_SCENARIO: needs approval is an experimental mode. With the feature off for the owner it is refused and the mode stays; with it on it is stored, and the older verb's listing reads it as no full access.
  it("sets needs approval only with the feature on", async () => {
    const off = harness({ toolApproval: false });
    const refused = await connectSlack(off);
    await expect(
      off.svc.setToolMode({ id: refused.id, mode: "needs-approval" }),
    ).rejects.toThrow(/experimental feature/);
    expect(off.rows.get(refused.id)!.toolAccess?.mode).toBe("read-only");
    await off.svc.setToolMode({ id: refused.id, mode: "allow-all" });
    expect(off.rows.get(refused.id)!.toolAccess?.mode).toBe("allow-all");

    const on = harness({ toolApproval: true });
    const created = await connectSlack(on);
    await on.svc.setToolMode({ id: created.id, mode: "needs-approval" });
    expect(on.rows.get(created.id)!.toolAccess?.mode).toBe("needs-approval");
    const view = await on.svc.getConnection(created.id);
    expect(view?.toolAccess?.mode).toBe("needs-approval");
    expect(view?.fullAccess).toBeUndefined();
  });

  // TEST_SCENARIO: a Connection made before tool access existed has a Secret that does not ask for request bodies, so its gateway sends none and the gate would refuse every call of a read-only Connection. Switching it to read only writes the Secret again with the flag, and keeps its fields.
  it("writes the body check on an older Secret when it turns read only", async () => {
    const h = harness();
    const created = await connectSlack(h, true);
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
    await h.svc.setFullAccess({ id: created.id, fullAccess: false });
    expect(hostEntries(h.secrets, created)[0]).toMatchObject({
      checkBody: true,
    });
    expect(h.secrets.get(path)!.fields.access_token).toBe("xoxp-real");
  });

  // TEST_SCENARIO: only a Template that declares tool access has a read-only mode. Naming full access on another Template, or switching a Connection that does not exist, is refused instead of stored as a flag that limits nothing.
  it("refuses the choice on a Template with no read tools", async () => {
    const h = harness();
    await expect(
      h.svc.createFromTemplate({
        templateId: "github",
        authKind: "oauth",
        name: "my-github",
        fullAccess: true,
      }),
    ).rejects.toThrow(/no read-only mode/);
    await expect(
      h.svc.setFullAccess({ id: "conn-missing", fullAccess: true }),
    ).rejects.toThrow(/not found/);
  });

  // TEST_SCENARIO: the catalog must say which Templates offer the choice, so a client shows it only there.
  it("lists the choice on the Template", async () => {
    const h = harness();
    const listed = await h.svc.listTemplates();
    expect(listed.find((t) => t.id === "slack")?.accessChoice).toEqual({
      fullAccessLabel: "Can post as me",
    });
    expect(listed.filter((t) => t.accessChoice).map((t) => t.id)).toEqual([
      "slack",
    ]);
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

  // TEST_SCENARIO: the owner sets a custom MCP Connection to read only. The gate's limit on its MCP host lets through only the tools the stored list marks as reading: not a write tool, and not a tool the list does not name.
  it("limits a read-only custom MCP Connection to its read tools", async () => {
    const h = harness({
      lister: fakeMcpToolLister({ ok: true, tools: NOTES_TOOLS }),
    });
    const created = await connectCustomMcp(h);
    await h.svc.setToolMode({ id: created.id, mode: "read-only" });
    const limit = toolAccessFor(
      [h.rows.get(created.id)!],
      (id) => templates.get(id),
      { host: "mcp.example.com", connectionId: null },
    );
    expect(limit).toMatchObject({ mode: "read-only" });
    expect(limit?.readTools).toEqual(["notes_search"]);
    expect(
      toolAccessFor([h.rows.get(created.id)!], (id) => templates.get(id), {
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
