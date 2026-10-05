import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "api-server-api";

import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import { createConnectionTemplateRegistry } from "../../modules/connections/domain/connection-template.js";
import {
  ACCOUNT_LABEL_INPUT_KEY,
  accountLabelOf,
} from "../../modules/connections/domain/account-label.js";
import {
  lookupGoogleAccount,
  lookupSlackAccount,
} from "../../modules/connections/infrastructure/account-lookups.js";
import { recordAccountLabel } from "../../modules/connections/services/account-label.js";
import { configureLogger } from "../../core/logger.js";

/**
 * TEST_OVERVIEW: a Connection that acts as a person records whose account it
 * acts as, so the product can name that person on every row that lists it.
 * The label comes from the provider, asked with the Connection's own
 * credential, and is stored as a platform-derived input. A template with no
 * way to ask is left alone, and a lookup that fails leaves the Connection
 * unlabelled instead of failing the connect.
 */

configureLogger({ level: "info", write: () => {} });

const templates = createConnectionTemplateRegistry(buildCatalog());

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function connection(templateId: string): Connection {
  return {
    id: `conn-${templateId}`,
    ownerId: "owner-sub",
    templateId,
    name: templateId,
    inputs: {},
    auth: { kind: "none" },
    contributions: [],
  };
}

function fakeRepo() {
  const merged = new Map<string, Record<string, unknown>>();
  return {
    merged,
    repo: {
      mergeInputs: async (id: string, patch: Record<string, unknown>) => {
        merged.set(id, { ...(merged.get(id) ?? {}), ...patch });
      },
    },
  };
}

function slackFetch(opts: { userInfoOk: boolean }) {
  return vi.fn(async (url: string | URL) => {
    const href = String(url);
    if (href.endsWith("/auth.test")) {
      return json({ ok: true, user: "jan", user_id: "U123", team: "Acme" });
    }
    if (href.includes("/users.info")) {
      return opts.userInfoOk
        ? json({ ok: true, user: { profile: { real_name: "Jan Jeliga" } } })
        : json({ ok: false, error: "missing_scope" });
    }
    throw new Error(`unexpected fetch ${href}`);
  });
}

describe("connection account label", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // TEST_SCENARIO: a Slack Account connection names the person and the workspace, because one install can serve several workspaces.
  it("names a Slack account by person and workspace", async () => {
    vi.stubGlobal("fetch", slackFetch({ userInfoOk: true }));
    expect(await lookupSlackAccount("xoxp-token")).toBe("Jan Jeliga (Acme)");
  });

  // TEST_SCENARIO: when the profile cannot be read, the Slack handle from auth.test still says whose account it is.
  it("falls back to the Slack handle when the profile is unreadable", async () => {
    vi.stubGlobal("fetch", slackFetch({ userInfoOk: false }));
    expect(await lookupSlackAccount("xoxp-token")).toBe("jan (Acme)");
  });

  // TEST_SCENARIO: a Google service connection is named by the account's email from the OpenID userinfo endpoint.
  it("names a Google account by its email", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ email: "jan@example.com", sub: "1" })),
    );
    expect(await lookupGoogleAccount("ya29.token")).toBe("jan@example.com");
  });

  // TEST_SCENARIO: the label lands on the Connection as a platform-derived input and is what the view reads back.
  it("records the label on the connection", async () => {
    vi.stubGlobal("fetch", slackFetch({ userInfoOk: true }));
    const { repo, merged } = fakeRepo();
    const conn = connection("slack");

    expect(
      await recordAccountLabel(conn, "xoxp-token", { repo, templates }),
    ).toBe(true);

    const inputs = merged.get(conn.id) ?? {};
    expect(inputs[ACCOUNT_LABEL_INPUT_KEY]).toBe("Jan Jeliga (Acme)");
    expect(accountLabelOf({ ...conn, inputs })).toBe("Jan Jeliga (Acme)");
  });

  // TEST_SCENARIO: a template that has no way to ask whose account it is never calls out and stays unlabelled.
  it("leaves a template without a lookup alone", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { repo, merged } = fakeRepo();

    expect(
      await recordAccountLabel(connection("custom-header"), "secret", {
        repo,
        templates,
      }),
    ).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(merged.size).toBe(0);
  });

  // TEST_SCENARIO: a provider refusing the lookup costs only the label, so connecting never fails because of it.
  it("swallows a failed lookup", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ ok: false, error: "invalid_auth" })),
    );
    const { repo, merged } = fakeRepo();
    const conn = connection("slack");

    expect(
      await recordAccountLabel(conn, "xoxp-revoked", { repo, templates }),
    ).toBe(false);
    expect(
      accountLabelOf({ ...conn, inputs: merged.get(conn.id) ?? {} }),
    ).toBeUndefined();
  });

  // TEST_SCENARIO: a re-consent may hand the connection someone else's credential, so a lookup that fails then drops the old person's name instead of keeping it.
  it("clears a previous label when the new lookup fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("rate limited", { status: 429 })),
    );
    const { repo, merged } = fakeRepo();
    const conn = connection("slack");
    merged.set(conn.id, { [ACCOUNT_LABEL_INPUT_KEY]: "Alice (Acme)" });

    await recordAccountLabel(conn, "xoxp-bob", { repo, templates });

    expect(
      accountLabelOf({ ...conn, inputs: merged.get(conn.id) ?? {} }),
    ).toBeUndefined();
  });
});
