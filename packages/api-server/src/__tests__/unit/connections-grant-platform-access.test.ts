// TEST_OVERVIEW: the Platform Access of one grant: what one Agent may do on the platform when it calls with its own Agent Key, kept on its grant of the platform Connection. Only the Connection's owner sets it, only on the platform Connection, and only for an Agent that holds it. Setting it narrows the Agent, so it needs no offer; clearing it gives the Agent its owner's access again, so the install must offer the Connection.
import { describe, expect, it } from "vitest";
import {
  DAM_TEMPLATE_ID,
  OWN_PLATFORM_ACCESS,
  type Connection,
} from "api-server-api";
import { configureLogger } from "../../core/logger.js";
import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import { createConnectionTemplateRegistry } from "../../modules/connections/domain/connection-template.js";
import {
  newConnectionsStore,
  serviceHarness,
} from "../helpers/connections-service.js";

const templates = createConnectionTemplateRegistry(buildCatalog({}));

const connectionOf = (id: string, templateId: string): Connection => ({
  id,
  ownerId: "owner",
  templateId,
  name: id,
  inputs: {},
  auth: {
    kind: "header",
    valueRef: { storeId: "test", path: id, field: "value" },
    headerName: "Authorization",
    valueFormat: "Bearer {value}",
  },
  contributions: [],
});

function harness(opts: { ownerId?: string; offered?: boolean } = {}) {
  const store = newConnectionsStore();
  store.rows.set("conn-dam", connectionOf("conn-dam", DAM_TEMPLATE_ID));
  store.rows.set("conn-other", connectionOf("conn-other", "custom-header"));
  store.grants.add("conn-dam|agent-a");
  store.grants.add("conn-other|agent-a");
  const { svc } = serviceHarness({
    templates,
    store,
    brandName: "Platform",
    damConnectionOffered: async () => opts.offered ?? true,
    ...(opts.ownerId ? { ownerId: opts.ownerId } : {}),
  });
  return { svc, store };
}

function capture() {
  const lines: string[] = [];
  configureLogger({ level: "info", write: (l) => lines.push(l) });
  return { records: () => lines.map((l) => JSON.parse(l)) };
}

const set = (
  h: ReturnType<typeof harness>,
  over: Partial<Parameters<typeof h.svc.setGrantPlatformAccess>[0]> = {},
) =>
  h.svc.setGrantPlatformAccess({
    agentId: "agent-a",
    connectionId: "conn-dam",
    access: OWN_PLATFORM_ACCESS,
    ...over,
  });

describe("the Platform Access of a grant", () => {
  // TEST_SCENARIO: the owner lets an Agent act as itself. The access is stored on that Agent's grant, and the change is a security event of the owner that says what the grant held before and holds now.
  it("stores the access on the Agent's grant and logs the change", async () => {
    const cap = capture();
    const h = harness();
    await set(h);
    expect(h.store.platformAccess.get("conn-dam|agent-a")).toEqual(
      OWN_PLATFORM_ACCESS,
    );
    const logged = cap
      .records()
      .find((r) => r.msg === "connection.grant_platform_access_update");
    expect(logged).toMatchObject({
      actor: "owner",
      actorKind: "user",
      agentId: "agent-a",
      target: "conn-dam",
      detail: { from: null, to: OWN_PLATFORM_ACCESS },
    });
  });

  // TEST_SCENARIO: the grant listing is where the owner, the CLI and the app read the access back, so it reports what the grant stores.
  it("reports the access with the Agent's grants", async () => {
    const h = harness();
    await set(h);
    const { connections } = await h.svc.getAgentConnections("agent-a");
    const dam = connections.find((c) => c.connectionId === "conn-dam");
    const other = connections.find((c) => c.connectionId === "conn-other");
    expect(dam?.platformAccess).toEqual(OWN_PLATFORM_ACCESS);
    expect(other?.platformAccess).toBeUndefined();
  });

  // TEST_SCENARIO: clearing the access takes the Agent off the scale: it acts with the Connection's own key again, as its owner.
  it("clears the access with null", async () => {
    const h = harness();
    await set(h);
    await set(h, { access: null });
    expect(h.store.platformAccess.has("conn-dam|agent-a")).toBe(false);
  });

  // TEST_SCENARIO: an install that no longer offers the platform Connection keeps what exists, and narrowing an Agent only lowers the risk. So the access can still be set there.
  it("sets the access on an install that does not offer the Connection", async () => {
    const h = harness({ offered: false });
    await set(h);
    expect(h.store.platformAccess.get("conn-dam|agent-a")).toEqual(
      OWN_PLATFORM_ACCESS,
    );
  });

  // TEST_SCENARIO: clearing the access gives an Agent its owner's full access, which is what granting the Connection does. An install that does not offer the Connection refuses both.
  it("refuses to clear the access on an install that does not offer the Connection", async () => {
    const h = harness({ offered: false });
    await set(h);
    await expect(set(h, { access: null })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(h.store.platformAccess.get("conn-dam|agent-a")).toEqual(
      OWN_PLATFORM_ACCESS,
    );
  });

  // TEST_SCENARIO: the scale is the platform's own. Any other Connection has nothing on it, and the refusal says so by the Connection's name.
  it("refuses a Connection that is not the platform's own", async () => {
    const h = harness();
    await expect(set(h, { connectionId: "conn-other" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining('"conn-other"'),
    });
  });

  // TEST_SCENARIO: an access with no grant to sit on would let nobody act. The Agent must hold the Connection first.
  it("refuses an Agent that does not hold the Connection", async () => {
    const h = harness();
    await expect(set(h, { agentId: "agent-b" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "connection is not granted to this agent",
    });
  });

  // TEST_SCENARIO: only the Connection's owner decides what an Agent may do with it. Anyone else is told the Connection does not exist.
  it("refuses anyone but the Connection's owner", async () => {
    const h = harness({ ownerId: "someone-else" });
    await expect(set(h)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
