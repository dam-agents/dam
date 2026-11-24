// TEST_OVERVIEW: the tool access of one grant: one Agent on one MCP Connection. Only the Connection's owner sets it, only with the `mcp-tool-approval` feature on, only for an Agent that holds the Connection, and only on a Connection whose requests the gateway reads. A change for one Agent leaves every other Agent's access as it was. An override equal to the rule of its tool's group is dropped, and the number of overrides and the length of a tool name are capped. A rule that limits tool calls writes the Connection's Secret again first, so an older Secret asks the gateway for request bodies. With the feature on, a new grant starts safe: read only on a Template whose default mode is read only, as the Slack Account, and reads allowed with every other tool asking elsewhere; with the feature off, it stores nothing and follows the Connection's mode. While the reader has the feature on, each grant's access comes with the Agent's Connections: the stored access, else the access of the Connection's mode, and none for a Connection the gateway does not read. With the feature off, no grant carries it. A grant that is new when it is written starts safe, also when another request revoked it after the first read. A new grant never starts looser than its Connection's tool mode: each group takes the stricter rule of the safe start and the mode. A grant mirrored to a child Agent copies what the parent's grant stores, nothing included, and a later change of the parent's access reaches the grants of its mirroring children. A child that takes its connections from a parent, mirrored or a subset, copies the parent's grant at create too, and a Connection the parent does not hold takes the starting access; only a mirroring child follows a later change of the parent's access.
import { describe, expect, it } from "vitest";
import type { Connection, GrantToolAccess } from "api-server-api";
import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import { createConnectionTemplateRegistry } from "../../modules/connections/domain/connection-template.js";
import {
  fakeMcpToolLister,
  newConnectionsStore,
  serviceHarness,
  type ConnectionsStore,
} from "../helpers/connections-service.js";
import type { XactLock } from "../../core/xact-lock.js";

const templates = createConnectionTemplateRegistry(
  buildCatalog({
    slack: { clientId: "slack-client", clientSecret: "shh" },
    github: { clientId: "Iv1.client", clientSecret: "shh" },
  }),
);

const HOSTS_ANNOTATION = "agent-platform.ai/injection-hosts";

const NOTES_TOOLS = [
  { name: "notes_search", readOnly: true },
  { name: "notes_write", readOnly: false },
];

const READ_ONLY: GrantToolAccess = {
  read: "allow",
  write: "block",
  overrides: {},
};
const ASK_WRITES: GrantToolAccess = {
  read: "allow",
  write: "ask",
  overrides: {},
};
const ALLOW_ALL: GrantToolAccess = {
  read: "allow",
  write: "allow",
  overrides: {},
};

function harness(
  opts: {
    toolApproval?: boolean;
    ownerId?: string;
    store?: ConnectionsStore;
    lock?: XactLock;
    children?: Record<string, string[]>;
    subsetChildren?: Record<string, string[]>;
  } = {},
) {
  const parentOf = async (agentId: string) =>
    [
      ...Object.entries(opts.children ?? {}),
      ...Object.entries(opts.subsetChildren ?? {}),
    ].find(([, kids]) => kids.includes(agentId))?.[0] ?? null;
  return serviceHarness({
    parentOf,
    templates,
    brandName: "Platform",
    toolApprovalOffered: async () => opts.toolApproval ?? true,
    mcpToolLister: fakeMcpToolLister({ ok: true, tools: NOTES_TOOLS }),
    ...(opts.ownerId ? { ownerId: opts.ownerId } : {}),
    ...(opts.store ? { store: opts.store } : {}),
    ...(opts.lock ? { lock: opts.lock } : {}),
    ...(opts.children
      ? {
          mirroredChildren: async (agentId: string) =>
            opts.children?.[agentId] ?? [],
        }
      : {}),
  });
}

type Harness = ReturnType<typeof harness>;

async function connectNotes(h: Harness): Promise<Connection> {
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

async function connectSlack(h: Harness): Promise<Connection> {
  const id = await h.svc.createFromTemplate({
    templateId: "slack",
    authKind: "oauth",
    name: "my-slack",
  });
  return h.rows.get(id)!;
}

async function accessOf(
  h: Harness,
  agentId: string,
  connectionId: string,
): Promise<GrantToolAccess | undefined> {
  const listed = await h.svc.getAgentConnections(agentId);
  return listed.connections.find((c) => c.connectionId === connectionId)
    ?.toolAccess;
}

function secretPathOf(connection: Connection): string {
  if (connection.auth.kind === "oauth")
    return connection.auth.accessTokenRef.path;
  if (connection.auth.kind === "header") return connection.auth.valueRef.path;
  throw new Error(`no Secret on a ${connection.auth.kind} auth`);
}

function dropBodyCheck(h: Harness, connection: Connection): void {
  const path = secretPathOf(connection);
  const stored = h.secrets.get(path)!;
  const entries = JSON.parse(stored.annotations[HOSTS_ANNOTATION]!) as {
    checkBody?: boolean;
  }[];
  h.secrets.set(path, {
    ...stored,
    annotations: {
      [HOSTS_ANNOTATION]: JSON.stringify(
        entries.map(({ checkBody: _, ...entry }) => entry),
      ),
    },
  });
}

function asksForBodies(h: Harness, connection: Connection): boolean {
  const entries = JSON.parse(
    h.secrets.get(secretPathOf(connection))!.annotations[HOSTS_ANNOTATION]!,
  ) as { checkBody?: boolean }[];
  return entries.some((entry) => entry.checkBody === true);
}

describe("setting the tool access of one grant", () => {
  // TEST_SCENARIO: two Agents hold the same Connection. The owner opens it for one of them only, and the other Agent keeps the access it had.
  it("changes one Agent's access and no other", async () => {
    const h = harness();
    const notes = await connectNotes(h);
    await h.svc.setAgentConnections("agent-1", [notes.id]);
    await h.svc.setAgentConnections("agent-2", [notes.id]);

    await h.svc.setGrantToolAccess({
      agentId: "agent-1",
      connectionId: notes.id,
      access: ALLOW_ALL,
    });
    expect(await accessOf(h, "agent-1", notes.id)).toEqual(ALLOW_ALL);
    expect(await accessOf(h, "agent-2", notes.id)).toEqual(ASK_WRITES);
  });

  // TEST_SCENARIO: someone who is not the Connection's owner sets the access, also an Editor of the Agent, whose own service does not find the owner's Connection. The call is refused and the grant keeps its access.
  it("refuses anyone but the Connection's owner", async () => {
    const store = newConnectionsStore();
    const owner = harness({ store });
    const notes = await connectNotes(owner);
    await owner.svc.setAgentConnections("agent-1", [notes.id]);

    const editor = harness({ store, ownerId: "editor" });
    await expect(
      editor.svc.setGrantToolAccess({
        agentId: "agent-1",
        connectionId: notes.id,
        access: ALLOW_ALL,
      }),
    ).rejects.toThrow(/not found/);
    expect(await accessOf(owner, "agent-1", notes.id)).toEqual(ASK_WRITES);
  });

  // TEST_SCENARIO: tool access for each Agent is an experimental feature. With it off for the owner, setting it is refused and nothing is stored.
  it("refuses with the feature off", async () => {
    const h = harness({ toolApproval: false });
    const notes = await connectNotes(h);
    await h.svc.setAgentConnections("agent-1", [notes.id]);
    await expect(
      h.svc.setGrantToolAccess({
        agentId: "agent-1",
        connectionId: notes.id,
        access: READ_ONLY,
      }),
    ).rejects.toThrow(/experimental feature/);
    expect(h.grantAccess.get(`${notes.id}|agent-1`)).toBeNull();
  });

  // TEST_SCENARIO: the access belongs to a grant, so an Agent that does not hold the Connection has none to set. A Connection whose requests pass the gateway unread, such as an MCP server with no auth, or one with no MCP server, has no access the gate could hold.
  it("refuses an Agent without the grant and a Connection the gateway does not read", async () => {
    const h = harness();
    const notes = await connectNotes(h);
    await expect(
      h.svc.setGrantToolAccess({
        agentId: "agent-1",
        connectionId: notes.id,
        access: READ_ONLY,
      }),
    ).rejects.toThrow(/not granted/);

    const open = await h.svc.createFromTemplate({
      templateId: "custom-mcp-none",
      authKind: "none",
      name: "my-open-mcp",
      url: "https://open.example.com/mcp",
    });
    const header = await h.svc.createFromTemplate({
      templateId: "custom-header",
      authKind: "header",
      name: "my-api",
      host: "api.example.com",
      headerName: "X-Api-Key",
      value: "secret",
    });
    await h.svc.setAgentConnections("agent-1", [open, header]);
    for (const connectionId of [open, header])
      await expect(
        h.svc.setGrantToolAccess({
          agentId: "agent-1",
          connectionId,
          access: READ_ONLY,
        }),
      ).rejects.toThrow(/no MCP server whose requests the platform reads/);
  });

  // TEST_SCENARIO: a client sends an override for every tool, also for tools whose rule equals their group's. Only the overrides that differ are stored: a read tool that asks while reads are allowed, and a tool the list does not name that is allowed while writes ask.
  it("drops an override equal to its group's rule", async () => {
    const h = harness();
    const notes = await connectNotes(h);
    await h.svc.setAgentConnections("agent-1", [notes.id]);
    await h.svc.setGrantToolAccess({
      agentId: "agent-1",
      connectionId: notes.id,
      access: {
        read: "allow",
        write: "ask",
        overrides: {
          notes_search: "ask",
          notes_write: "ask",
          notes_new: "allow",
          notes_other: "ask",
        },
      },
    });
    expect(h.grantAccess.get(`${notes.id}|agent-1`)).toEqual({
      read: "allow",
      write: "ask",
      overrides: { notes_search: "ask", notes_new: "allow" },
    });
  });

  // TEST_SCENARIO: the access is stored on the grant row and read on every tool call, so its size is capped: a tool name longer than 256 characters, an empty one, and more than 500 overrides that differ from their group are refused.
  it("caps the overrides and the length of a tool name", async () => {
    const h = harness();
    const notes = await connectNotes(h);
    await h.svc.setAgentConnections("agent-1", [notes.id]);
    const set = (overrides: Record<string, "allow" | "ask" | "block">) =>
      h.svc.setGrantToolAccess({
        agentId: "agent-1",
        connectionId: notes.id,
        access: { read: "allow", write: "ask", overrides },
      });
    await expect(set({ ["t".repeat(257)]: "block" })).rejects.toThrow(
      /1 to 256 characters/,
    );
    await expect(set({ "": "block" })).rejects.toThrow(/1 to 256 characters/);
    const many = Object.fromEntries(
      Array.from({ length: 501 }, (_, i) => [`tool_${i}`, "block" as const]),
    );
    await expect(set(many)).rejects.toThrow(/at most 500/);
    const fine = Object.fromEntries(
      Array.from({ length: 501 }, (_, i) => [
        `tool_${i}`,
        i === 0 ? ("block" as const) : ("ask" as const),
      ]),
    );
    await set(fine);
    expect(h.grantAccess.get(`${notes.id}|agent-1`)?.overrides).toEqual({
      tool_0: "block",
    });
  });

  // TEST_SCENARIO: the Connection was made before every MCP Connection with a Secret asked the gateway for request bodies. A rule that limits tool calls writes its Secret again with the flag before it is stored, so the gate can read the calls instead of refusing every one.
  it("writes the body check on an older Secret before a limiting rule", async () => {
    const h = harness();
    const notes = await connectNotes(h);
    await h.svc.setAgentConnections("agent-1", [notes.id]);
    dropBodyCheck(h, notes);
    await h.svc.setGrantToolAccess({
      agentId: "agent-1",
      connectionId: notes.id,
      access: ALLOW_ALL,
    });
    expect(asksForBodies(h, notes)).toBe(false);
    await h.svc.setGrantToolAccess({
      agentId: "agent-1",
      connectionId: notes.id,
      access: { ...ALLOW_ALL, overrides: { notes_write: "block" } },
    });
    expect(asksForBodies(h, notes)).toBe(true);
  });
});

describe("the tool access a new grant starts with", () => {
  // TEST_SCENARIO: with the feature on, a new grant starts safe. A Slack Account posts as the owner, so it starts read only; any other MCP Connection starts with reads allowed and writes asking. A Connection the gateway does not read stores nothing.
  it("starts safe with the feature on", async () => {
    const h = harness();
    const slack = await connectSlack(h);
    const notes = await connectNotes(h);
    const header = await h.svc.createFromTemplate({
      templateId: "custom-header",
      authKind: "header",
      name: "my-api",
      host: "api.example.com",
      headerName: "X-Api-Key",
      value: "secret",
    });
    await h.svc.setAgentConnections("agent-1", [slack.id, notes.id, header]);
    expect(h.grantAccess.get(`${slack.id}|agent-1`)).toEqual(READ_ONLY);
    expect(h.grantAccess.get(`${notes.id}|agent-1`)).toEqual(ASK_WRITES);
    expect(h.grantAccess.get(`${header}|agent-1`)).toBeNull();
  });

  // TEST_SCENARIO: with the feature off, nothing changes from main: a new grant stores no access and follows its Connection's mode.
  it("stores nothing with the feature off", async () => {
    const h = harness({ toolApproval: false });
    const slack = await connectSlack(h);
    const notes = await connectNotes(h);
    await h.svc.updateAgentConnections("agent-1", {
      grant: [slack.id, notes.id],
      revoke: [],
    });
    expect(h.grantAccess.get(`${slack.id}|agent-1`)).toBeNull();
    expect(h.grantAccess.get(`${notes.id}|agent-1`)).toBeNull();
  });

  // TEST_SCENARIO: another request revokes a grant after this request read the Agent's grants and before it takes the Agent's lock, so the Connection is new again when the grant is written. It still starts safe, not with its Connection's mode, which allows all here, and its older Secret is written again to ask for request bodies.
  it("starts safe for a grant that became new after the first read", async () => {
    const store = newConnectionsStore();
    let revokeOnLock: string | null = null;
    const lock: XactLock = async (key, fn) => {
      if (revokeOnLock && key === "agent:connections:agent-1") {
        store.grants.delete(revokeOnLock);
        store.grantAccess.delete(revokeOnLock);
        revokeOnLock = null;
      }
      return fn();
    };
    const h = harness({ store, lock });
    const notes = await connectNotes(h);
    await h.svc.setAgentConnections("agent-1", [notes.id]);
    await h.svc.setGrantToolAccess({
      agentId: "agent-1",
      connectionId: notes.id,
      access: ALLOW_ALL,
    });
    dropBodyCheck(h, notes);

    revokeOnLock = `${notes.id}|agent-1`;
    await h.svc.setAgentConnections("agent-1", [notes.id]);
    expect(revokeOnLock).toBeNull();
    expect(h.grantAccess.get(`${notes.id}|agent-1`)).toEqual(ASK_WRITES);
    expect(asksForBodies(h, notes)).toBe(true);
  });

  // TEST_SCENARIO: the owner opened a Connection for one Agent, then grants it to another. The new grant starts safe and does not copy the first Agent's access, and a grant the Agent already holds keeps its own access when the set is written again.
  it("never copies another Agent's access, and keeps an existing grant's", async () => {
    const h = harness();
    const notes = await connectNotes(h);
    await h.svc.setAgentConnections("agent-1", [notes.id]);
    await h.svc.setGrantToolAccess({
      agentId: "agent-1",
      connectionId: notes.id,
      access: ALLOW_ALL,
    });
    await h.svc.setAgentConnections("agent-2", [notes.id]);
    expect(await accessOf(h, "agent-2", notes.id)).toEqual(ASK_WRITES);
    await h.svc.setAgentConnections("agent-1", [notes.id]);
    expect(await accessOf(h, "agent-1", notes.id)).toEqual(ALLOW_ALL);
  });

  // TEST_SCENARIO: a new grant of a Connection whose Secret does not ask for request bodies yet starts with a rule that limits tool calls. Its Secret is written again with the flag, so the gate can read the Agent's calls from the start.
  it("writes the body check on an older Secret for a new limiting grant", async () => {
    const h = harness();
    const notes = await connectNotes(h);
    dropBodyCheck(h, notes);
    await h.svc.setAgentConnections("agent-1", [notes.id]);
    expect(asksForBodies(h, notes)).toBe(true);
  });
});

describe("reading the tool access of an Agent's grants", () => {
  // TEST_SCENARIO: a client lists an Agent's Connections. Each grant of a Connection the gateway reads carries its access: the stored one, else the access of the Connection's mode. A grant of any other Connection carries none.
  it("returns the access of each grant the gateway reads", async () => {
    const h = harness();
    const notes = await connectNotes(h);
    const slack = await connectSlack(h);
    const header = await h.svc.createFromTemplate({
      templateId: "custom-header",
      authKind: "header",
      name: "my-api",
      host: "api.example.com",
      headerName: "X-Api-Key",
      value: "secret",
    });
    await h.svc.setAgentConnections("agent-1", [notes.id, slack.id, header]);
    await h.svc.setToolMode({ id: slack.id, mode: "allow-all" });

    const listed = await h.svc.getAgentConnections("agent-1");
    const byId = new Map(listed.connections.map((c) => [c.connectionId, c]));
    expect(byId.get(notes.id)?.toolAccess).toEqual(ASK_WRITES);
    expect(byId.get(slack.id)?.toolAccess).toEqual(ALLOW_ALL);
    expect(byId.get(header)).not.toHaveProperty("toolAccess");
  });

  // TEST_SCENARIO: with the feature off for the person who reads, clients show what they showed before tool access moved to the grant: no grant carries `toolAccess`, even one that stores access of its own. The gate still reads the stored access.
  it("returns no access with the feature off", async () => {
    const store = newConnectionsStore();
    const on = harness({ store });
    const notes = await connectNotes(on);
    const slack = await connectSlack(on);
    await on.svc.setAgentConnections("agent-1", [notes.id, slack.id]);
    await on.svc.setGrantToolAccess({
      agentId: "agent-1",
      connectionId: notes.id,
      access: ALLOW_ALL,
    });

    const off = harness({ store, toolApproval: false });
    const listed = await off.svc.getAgentConnections("agent-1");
    expect(listed.connections).toHaveLength(2);
    for (const grant of listed.connections)
      expect(grant).not.toHaveProperty("toolAccess");
    expect(store.grantAccess.get(`${notes.id}|agent-1`)).toEqual(ALLOW_ALL);
  });
});

describe("a new grant and its Connection's mode", () => {
  // TEST_SCENARIO: the owner set a Connection to read only, then grants it to a new Agent. The safe start would let writes ask, which is looser than the owner's choice, so writes stay blocked. A Connection that needs approval starts the same as the safe start.
  it("never starts looser than the mode", async () => {
    const h = harness();
    const notes = await connectNotes(h);
    await h.svc.setToolMode({ id: notes.id, mode: "read-only" });
    await h.svc.setAgentConnections("agent-1", [notes.id]);
    expect(h.grantAccess.get(`${notes.id}|agent-1`)).toEqual(READ_ONLY);

    await h.svc.setToolMode({ id: notes.id, mode: "needs-approval" });
    await h.svc.setAgentConnections("agent-2", [notes.id]);
    expect(h.grantAccess.get(`${notes.id}|agent-2`)).toEqual(ASK_WRITES);
  });

  // TEST_SCENARIO: the owner let a Slack Account post as them, with allow all. The mode is looser than the safe start, so a new grant still starts read only, as the safe start says.
  it("keeps the safe start where the mode is looser", async () => {
    const h = harness();
    const slack = await connectSlack(h);
    await h.svc.setToolMode({ id: slack.id, mode: "allow-all" });
    await h.svc.setAgentConnections("agent-1", [slack.id]);
    expect(h.grantAccess.get(`${slack.id}|agent-1`)).toEqual(READ_ONLY);
  });
});

describe("the grants of a child that mirrors its parent", () => {
  // TEST_SCENARIO: a sub-agent often cannot ask a person, so a grant mirrored to it copies the parent's grant instead of the starting access: the access the owner opened for the parent, the parent's starting access on a Connection it gets later, and nothing where the parent stores nothing, so both follow the Connection's mode.
  it("copies what the parent's grant stores", async () => {
    const h = harness({ children: { "agent-1": ["child-1"] } });
    const notes = await connectNotes(h);
    const slack = await connectSlack(h);
    const other = await h.svc.createFromTemplate({
      templateId: "custom-mcp-none",
      authKind: "none",
      name: "my-other",
      url: "https://other.example.com/mcp",
      headerName: "X-Api-Key",
      value: "other-key",
    });
    await h.svc.setAgentConnections("agent-1", [notes.id, other]);
    await h.svc.setGrantToolAccess({
      agentId: "agent-1",
      connectionId: notes.id,
      access: ALLOW_ALL,
    });
    await h.svc.setToolMode({ id: other, mode: "allow-all" });
    h.grantAccess.delete(`${notes.id}|child-1`);
    h.grantAccess.delete(`${other}|child-1`);
    h.grants.delete(`${notes.id}|child-1`);
    h.grants.delete(`${other}|child-1`);

    await h.svc.updateAgentConnections("agent-1", {
      grant: [slack.id],
      revoke: [],
    });
    expect(h.grantAccess.get(`${notes.id}|child-1`)).toEqual(ALLOW_ALL);
    expect(h.grantAccess.get(`${slack.id}|child-1`)).toEqual(READ_ONLY);
    expect(h.grantAccess.has(`${other}|child-1`)).toBe(true);
    expect(h.grantAccess.get(`${other}|child-1`)).toBeNull();
  });

  // TEST_SCENARIO: the owner tightens the parent's access after its children hold the Connection. The change reaches every child that mirrors the parent, and through it the child's own mirroring child, so none of them stays looser than the parent. An Agent that only holds the Connection on its own is not touched.
  it("passes a later change of the parent's access to its children", async () => {
    const h = harness({
      children: { "agent-1": ["child-1"], "child-1": ["grandchild-1"] },
    });
    const notes = await connectNotes(h);
    await h.svc.setAgentConnections("agent-1", [notes.id]);
    await h.svc.setAgentConnections("agent-2", [notes.id]);
    expect(h.grantAccess.get(`${notes.id}|grandchild-1`)).toEqual(ASK_WRITES);

    await h.svc.setGrantToolAccess({
      agentId: "agent-1",
      connectionId: notes.id,
      access: READ_ONLY,
    });
    expect(h.grantAccess.get(`${notes.id}|child-1`)).toEqual(READ_ONLY);
    expect(h.grantAccess.get(`${notes.id}|grandchild-1`)).toEqual(READ_ONLY);
    expect(h.grantAccess.get(`${notes.id}|agent-2`)).toEqual(ASK_WRITES);
  });

  async function parentWithThreeGrants(h: Harness) {
    const notes = await connectNotes(h);
    const slack = await connectSlack(h);
    const other = await h.svc.createFromTemplate({
      templateId: "custom-mcp-none",
      authKind: "none",
      name: "my-other",
      url: "https://other.example.com/mcp",
      headerName: "X-Api-Key",
      value: "other-key",
    });
    const unheld = await h.svc.createFromTemplate({
      templateId: "custom-mcp-none",
      authKind: "none",
      name: "my-unheld",
      url: "https://unheld.example.com/mcp",
      headerName: "X-Api-Key",
      value: "unheld-key",
    });
    await h.svc.setAgentConnections("agent-1", [notes.id, slack.id, other]);
    await h.svc.setGrantToolAccess({
      agentId: "agent-1",
      connectionId: notes.id,
      access: ALLOW_ALL,
    });
    await h.svc.setToolMode({ id: other, mode: "allow-all" });
    return { notes: notes.id, slack: slack.id, other, unheld };
  }

  // TEST_SCENARIO: a sub-agent launched with all its parent's connections gets its grants at create. Each copies the parent's grant: the access the owner opened for the parent, looser than the safe start, the parent's read only on Slack, and nothing where the parent stores nothing. A Connection the parent does not hold takes the starting access.
  it("copies the parent's access at create for a mirroring child", async () => {
    const children: Record<string, string[]> = {};
    const h = harness({ children });
    const ids = await parentWithThreeGrants(h);
    children["agent-1"] = ["child-1"];
    await h.svc.setAgentConnections("child-1", [
      ids.notes,
      ids.slack,
      ids.other,
      ids.unheld,
    ]);
    expect(h.grantAccess.get(`${ids.notes}|child-1`)).toEqual(ALLOW_ALL);
    expect(h.grantAccess.get(`${ids.slack}|child-1`)).toEqual(READ_ONLY);
    expect(h.grantAccess.has(`${ids.other}|child-1`)).toBe(true);
    expect(h.grantAccess.get(`${ids.other}|child-1`)).toBeNull();
    expect(h.grantAccess.get(`${ids.unheld}|child-1`)).toEqual(ASK_WRITES);
  });

  // TEST_SCENARIO: a sub-agent launched with a subset of its parent's connections copies the parent's grants at create the same way. Its grant set is not kept in step with the parent's, and neither is its access: a later change of the parent's access does not reach it.
  it("copies the parent's access at create for a subset child, once", async () => {
    const subsetChildren: Record<string, string[]> = {};
    const h = harness({ subsetChildren });
    const ids = await parentWithThreeGrants(h);
    subsetChildren["agent-1"] = ["child-1"];
    await h.svc.setAgentConnections("child-1", [ids.notes, ids.other]);
    expect(h.grantAccess.get(`${ids.notes}|child-1`)).toEqual(ALLOW_ALL);
    expect(h.grantAccess.get(`${ids.other}|child-1`)).toBeNull();

    await h.svc.setGrantToolAccess({
      agentId: "agent-1",
      connectionId: ids.notes,
      access: READ_ONLY,
    });
    expect(h.grantAccess.get(`${ids.notes}|child-1`)).toEqual(ALLOW_ALL);
  });
});
