// TEST_OVERVIEW: the owner's choice between read only and full access on a Connection whose Template declares read tools, which the Slack Account does. A new Connection is read only unless the create names full access. The owner switches it later with one verb, the listing says which it is and what the Template calls full access, and the Connection's Secret tells the gateway to send request bodies to the check. A Template with no read tools offers no such choice.
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

function harness() {
  return serviceHarness({ templates, brandName: "Platform" });
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

describe("the access choice of a Slack Account Connection", () => {
  // TEST_SCENARIO: the owner connects Slack and names no access. Posting as the owner must be a choice, so the new Connection is read only, its listing offers the choice under the Template's own label, and its Secret asks the gateway for request bodies on Slack's MCP host.
  it("makes a new Connection read only", async () => {
    const h = harness();
    const created = await connectSlack(h);
    expect(created.auth).not.toHaveProperty("fullAccess");
    const view = await h.svc.getConnection(created.id);
    expect(view?.fullAccess).toBeUndefined();
    expect(view?.accessChoice).toEqual({ fullAccessLabel: "Can post as me" });
    expect(hostEntries(h.secrets, created)).toEqual([
      expect.objectContaining({ host: "mcp.slack.com", checkBody: true }),
    ]);
  });

  // TEST_SCENARIO: the owner connects Slack and names full access. The Connection says so on its auth, where the gate reads it, and not in its recorded inputs.
  it("gives full access when the create names it", async () => {
    const h = harness();
    const created = await connectSlack(h, true);
    expect(created.auth).toMatchObject({ fullAccess: true });
    expect(created.inputs).not.toHaveProperty("fullAccess");
    expect((await h.svc.getConnection(created.id))?.fullAccess).toBe(true);
  });

  // TEST_SCENARIO: the owner changes their mind in both directions. The verb writes the choice on the Connection, and the rest of its auth stays.
  it("switches between full access and read only", async () => {
    const h = harness();
    const created = await connectSlack(h);
    await h.svc.setFullAccess({ id: created.id, fullAccess: true });
    expect(h.rows.get(created.id)!.auth).toEqual({
      ...created.auth,
      fullAccess: true,
    });
    await h.svc.setFullAccess({ id: created.id, fullAccess: false });
    expect(h.rows.get(created.id)!.auth).toEqual(created.auth);
  });

  // TEST_SCENARIO: a Connection made before read tools existed has a Secret that does not ask for request bodies, so its gateway sends none and the gate would refuse every call of a read-only Connection. Switching it to read only writes the Secret again with the flag, and keeps its fields.
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

  // TEST_SCENARIO: only a Template that declares read tools has a read-only mode. Naming full access on another Template, or switching another Connection, is refused instead of stored as a flag that limits nothing.
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
