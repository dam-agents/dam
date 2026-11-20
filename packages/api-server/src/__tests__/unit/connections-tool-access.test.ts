// TEST_OVERVIEW: the tool mode of an MCP Connection. A Slack Account, whose Template declares its tool access, is read only unless the create names full access, offers all three modes, and its owner switches it with one verb; the older read-only / full-access verb maps onto the mode. The listing shows the mode on MCP Connections only, and the Connection's Secret tells the gateway to send request bodies to the check. Every other MCP Connection offers allow all alone, and needs approval is open only to an owner with the feature on.
import { describe, expect, it } from "vitest";
import type { Connection } from "api-server-api";
import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import { createConnectionTemplateRegistry } from "../../modules/connections/domain/connection-template.js";
import { serviceHarness } from "../helpers/connections-service.js";

const templates = createConnectionTemplateRegistry(
  buildCatalog({
    slack: { clientId: "slack-client", clientSecret: "shh" },
    github: { clientId: "Iv1.client", clientSecret: "shh" },
  }),
);

const HOSTS_ANNOTATION = "agent-platform.ai/injection-hosts";

function harness(opts: { toolApproval?: boolean } = {}) {
  return serviceHarness({
    templates,
    brandName: "Platform",
    toolApprovalOffered: async () => opts.toolApproval ?? true,
  });
}

function hostEntries(
  secrets: ReturnType<typeof harness>["secrets"],
  connection: Connection,
): { host: string; checkBody?: boolean }[] {
  if (connection.auth.kind !== "oauth") throw new Error("not an OAuth auth");
  return JSON.parse(
    secrets.get(connection.auth.accessTokenRef.path)!.annotations[
      HOSTS_ANNOTATION
    ]!,
  );
}

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

describe("the tool mode of other Connections", () => {
  // TEST_SCENARIO: a custom MCP server is an MCP Connection, but the gateway does not read its requests yet. Its listing shows allow all as the only mode, a stricter mode is refused, and a Connection with no MCP server shows no mode at all.
  it("offers allow all alone on another MCP Connection, and nothing elsewhere", async () => {
    const h = harness();
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
  });
});
