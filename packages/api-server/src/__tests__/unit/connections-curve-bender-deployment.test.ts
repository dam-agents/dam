import { describe, expect, it } from "vitest";
import {
  CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
  CURVE_BENDER_HOST,
  displayNameForTemplate,
  type Connection,
  type Contribution,
  type ConnectionTemplateView,
  type ConnectionView,
} from "api-server-api";

import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import { createConnectionTemplateRegistry } from "../../modules/connections/domain/connection-template.js";
import { configureLogger } from "../../core/logger.js";

import {
  type ConnectionsStore,
  newConnectionsStore,
  serviceHarness,
  type StoredSecret,
} from "../helpers/connections-service.js";

/**
 * TEST_OVERVIEW: the deployment's CurveBender is one Connection per user,
 * created by the listing while the install sets a deployment key: its Secret
 * holds that key for the gateway to inject on CurveBender's host, it reads as
 * Connected and carries CurveBender's models under the preset's alias, and it
 * leaves the user's own keyed CurveBender Connection and its personal key
 * alone. Without a key the provider does not exist, so nothing is created and
 * a leftover is removed; the key never appears in a user-facing answer; and
 * the user cannot create, update or delete the Connection by hand.
 */

configureLogger({ level: "error", write: () => {} });

const DEPLOYMENT_KEY = "sk-deployment-curvebender";

const templates = (configured = true) =>
  createConnectionTemplateRegistry(
    buildCatalog({}, { curveBenderDeployment: configured }),
  );

function makeService(
  opts: {
    configured?: boolean;
    key?: string | null;
    store?: ConnectionsStore;
  } = {},
) {
  return serviceHarness({
    templates: templates(opts.configured ?? true),
    ...(opts.store ? { store: opts.store } : {}),
    brandName: "Acme",
    platformProviderEnabled: async () => false,
    platformProviderKey: null,
    curveBenderDeploymentKey:
      opts.key === undefined ? DEPLOYMENT_KEY : opts.key,
  });
}

const deploymentRows = (rows: Map<string, Connection>) =>
  [...rows.values()].filter(
    (c) => c.templateId === CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
  );

function secretOf(
  secrets: Map<string, StoredSecret>,
  conn: Connection,
): StoredSecret | undefined {
  if (conn.auth.kind !== "header") throw new Error("not a header Connection");
  return secrets.get(conn.auth.valueRef.path);
}

function injectionHosts(secret: StoredSecret | undefined) {
  return JSON.parse(
    secret?.annotations["agent-platform.ai/injection-hosts"] ?? "[]",
  );
}

function injectionScopes(contributions: readonly Contribution[]) {
  return contributions
    .flatMap((c) =>
      c.kind === "egress-inject" && c.host === CURVE_BENDER_HOST
        ? [c.pathPattern ?? "(every path)"]
        : [],
    )
    .sort();
}

const ALLOWED_PATHS = [
  "/v1/chat/completions",
  "/v1/messages",
  "/v1/models",
  "/v1/responses",
];

function noKeyIn(answer: readonly (ConnectionView | ConnectionTemplateView)[]) {
  return !JSON.stringify(answer).includes(DEPLOYMENT_KEY);
}

describe("deployment CurveBender connection", () => {
  // TEST_SCENARIO: a listing on an install with a deployment key gives the user one CurveBender Connection under the original name, whose Secret holds the deployment key as the bearer injected on CurveBender's host and whose env names the proxy, while a personal CurveBender Connection keeps its own name and personal key.
  it("connects the deployment provider without touching the personal one", async () => {
    const { svc, rows, secrets } = makeService();
    const personalId = await svc.createFromTemplate({
      templateId: "curve-bender",
      name: "my-curve-bender",
      authKind: "header",
      value: "sk-personal",
    });
    const personalRow = rows.get(personalId)!;
    expect(secretOf(secrets, personalRow)?.fields.value).toBe("sk-personal");

    const views = await svc.listAndReconcileConnections();

    const [shared] = deploymentRows(rows);
    expect(deploymentRows(rows)).toHaveLength(1);
    expect(shared!.name).toBe(
      displayNameForTemplate(CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID),
    );
    const secret = secretOf(secrets, shared!);
    expect(secret?.purpose).toBe(
      `connection:${CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID}`,
    );
    expect(secret?.fields.value).toBe(DEPLOYMENT_KEY);
    expect(Object.values(secret!.fields)).toContainEqual(
      expect.stringContaining(`"Bearer ${DEPLOYMENT_KEY}"`),
    );
    expect(
      injectionHosts(secret)
        .map((h: { host: string; pathPattern: string }) => h.pathPattern)
        .sort(),
    ).toEqual(ALLOWED_PATHS);
    expect(injectionHosts(secret)).toContainEqual(
      expect.objectContaining({
        host: CURVE_BENDER_HOST,
        pathPattern: "/v1/messages",
      }),
    );
    expect(
      injectionHosts(secret).some(
        (h: { pathRewrites?: unknown }) => h.pathRewrites !== undefined,
      ),
    ).toBe(false);

    const personalAfter = rows.get(personalId)!;
    expect(personalAfter.templateId).toBe("curve-bender");
    expect(secretOf(secrets, personalAfter)?.fields.value).toBe("sk-personal");

    const sharedView = views.find(
      (v) => v.templateId === CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
    )!;
    expect(sharedView).toMatchObject({
      status: "active",
      authKind: "header",
      category: "app",
      hosts: [CURVE_BENDER_HOST],
      provider: { alias: "cb" },
    });
    expect(sharedView.name).toBe(
      displayNameForTemplate(CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID),
    );
    expect(injectionScopes(sharedView.contributions)).toEqual(ALLOWED_PATHS);
    expect(sharedView.contributions).toContainEqual({
      kind: "env",
      name: "OPENAI_BASE_URL",
      placeholder: `https://${CURVE_BENDER_HOST}`,
    });
  });

  // TEST_SCENARIO: the deployment's key is one key for every user, so the gateway injects it on the model listing and the three dialect paths alone, and on nothing else: not the proxy's management routes, and not its shared-state routes, which one identity would share between users. The personal preset keeps injecting on every path of the same host.
  it("injects the key on the paths the runtime calls and no others", () => {
    const catalog = buildCatalog({}, { curveBenderDeployment: true });
    const deployment = catalog.find(
      (t) => t.id === CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
    )!;
    expect(injectionScopes(deployment.contributions)).toEqual(ALLOWED_PATHS);
    for (const shared of [
      "/v1/files",
      "/v1/batches",
      "/v1/vector_stores",
      "/v1/assistants",
      "/v1/threads",
      "/v1/memory",
      "/v1/mcp/servers",
      "/v1/traces",
    ])
      expect(
        deployment.contributions.some(
          (c) => c.kind === "egress-inject" && c.pathPattern === shared,
        ),
      ).toBe(false);

    const personal = catalog.find((t) => t.id === "curve-bender")!;
    expect(injectionScopes(personal.contributions)).toEqual(["(every path)"]);
  });

  // TEST_SCENARIO: a listing checks a settled connection by reading its Secret once, not once for the key and again for a CA CurveBender never has.
  it("reads the connection's Secret once per listing", async () => {
    const { svc, secretReads } = makeService();
    await svc.listAndReconcileConnections();

    secretReads.get = 0;
    secretReads.getField = 0;
    await svc.listAndReconcileConnections();

    expect(secretReads.get).toBe(1);
    expect(secretReads.getField).toBe(0);
  });

  // TEST_SCENARIO: an install without a deployment key has no such template, so a listing creates nothing, and one left over from when it did is removed.
  it("creates nothing and removes a leftover without a deployment key", async () => {
    const store = newConnectionsStore();
    const before = makeService({ store });
    await before.svc.listAndReconcileConnections();
    expect(deploymentRows(store.rows)).toHaveLength(1);

    const after = makeService({ store, configured: false, key: null });
    await after.svc.listAndReconcileConnections();

    expect(deploymentRows(store.rows)).toHaveLength(0);
    expect(
      buildCatalog({}, { curveBenderDeployment: false }).some(
        (t) => t.id === CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
      ),
    ).toBe(false);
  });

  // TEST_SCENARIO: the deployment's key is the connection's Secret alone, so neither the provider Connection listing nor the template catalog a browser reads carries it.
  it("never returns the deployment key to a user", async () => {
    const { svc } = makeService();
    const views = await svc.listAndReconcileConnections();
    expect(
      views.some((v) => v.templateId === CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID),
    ).toBe(true);
    expect(noKeyIn(views)).toBe(true);
    expect(noKeyIn(await svc.listTemplates())).toBe(true);
  });

  // TEST_SCENARIO: the user's own create, update and delete refuse the deployment provider with its own words, not the built-in provider's feature hint, so its Secret keeps the deployment's key.
  it("refuses to change the connection by hand", async () => {
    const { svc, rows } = makeService();
    await svc.listAndReconcileConnections();
    const [shared] = deploymentRows(rows);

    await expect(svc.deleteConnection(shared!.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringContaining("managed by the deployment"),
    });
    await expect(
      svc.createFromTemplate({
        templateId: CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
        name: "mine",
        authKind: "header",
        value: "sk-mine",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      svc.update(shared!.id, { value: "sk-mine" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(deploymentRows(rows)).toHaveLength(1);
  });

  // TEST_SCENARIO: rotating the deployment key rewrites the connection's Secret in place on the next listing, once.
  it("rewrites the secret when the deployment key rotates", async () => {
    const store = newConnectionsStore();
    const before = makeService({ store });
    await before.svc.listAndReconcileConnections();
    const [old] = deploymentRows(store.rows);

    const after = makeService({ store, key: "sk-rotated" });
    await after.svc.listAndReconcileConnections();
    await after.svc.listAndReconcileConnections();

    const [conn] = deploymentRows(store.rows);
    expect(conn!.id).toBe(old!.id);
    expect(secretOf(store.secrets, conn!)?.fields.value).toBe("sk-rotated");
    expect(after.fannedOut).toEqual(["agent-1"]);
  });

  // TEST_SCENARIO: a user who already named a Connection after the provider gets the deployment's under the next free fallback name, so the reconcile settles rather than looping on a duplicate name.
  it("falls back to a free name when the provider's name is taken", async () => {
    const store = newConnectionsStore();
    store.rows.set("conn-taken", {
      id: "conn-taken",
      ownerId: "owner",
      templateId: "github",
      name: displayNameForTemplate(CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID)!,
      inputs: {},
      auth: { kind: "none" },
      contributions: [],
    });
    const { svc } = makeService({ store });

    await svc.listAndReconcileConnections();
    await svc.listAndReconcileConnections();

    expect(deploymentRows(store.rows).map((c) => c.name)).toEqual([
      "CurveBender LLM",
    ]);
  });
});
