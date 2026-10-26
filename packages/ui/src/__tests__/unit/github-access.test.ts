// TEST_OVERVIEW: what a GitHub connection made from a sign-in or an installation reaches, as its row says it: the account, the repositories by name when known or else by count, and how many permissions, each one listed only in the row's tooltip and on the secret-entry page; or a full-access line in the danger tone. The scope dialogs send full access only as an explicit flag, and a narrowed choice with nothing chosen sends nothing.
import type { ConnectionView } from "api-server-api";
import { describe, expect, it } from "vitest";

import { connectionDetail } from "../../modules/connections/lib/connection-detail.js";
import {
  connectionScopeSummary,
  fullAccessLine,
} from "../../modules/connections/lib/github-access.js";
import { appScopeChoice } from "../../modules/connections/lib/github-app-scope-fields.js";

const view = (fields: Partial<ConnectionView>): ConnectionView =>
  ({ id: "c", name: "c", authKind: "oauth", ...fields }) as ConnectionView;

describe("connection scope summary", () => {
  it("says the account, the repository names and how many permissions a sign-in connection has", () => {
    expect(
      connectionScopeSummary(
        view({
          githubUserToken: {
            scope: {
              targetId: 1,
              targetLogin: "acme",
              repositoryIds: [1, 2],
              repositoryNames: ["api", "web"],
              permissions: { issues: "write", contents: "read" },
            },
          },
        }),
      ),
    ).toBe("acme · api, web · 2 permissions");
  });

  it("says one permission in the singular", () => {
    expect(
      connectionScopeSummary(
        view({
          githubUserToken: {
            scope: { targetId: 1, permissions: { issues: "write" } },
          },
        }),
      ),
    ).toBe("account 1 · all repositories · 1 permission");
  });

  it("counts the permissions of an installation connection", () => {
    expect(
      connectionScopeSummary(
        view({
          authKind: "github-app",
          githubAppScope: {
            repositories: ["api"],
            permissions: { contents: "read", issues: "write", pulls: "write" },
          },
          check: { status: "passed", at: "x", installedOn: "acme" },
        }),
      ),
    ).toBe("acme · api · 3 permissions");
  });

  it("lists each permission when asked to", () => {
    expect(
      connectionScopeSummary(
        view({
          githubUserToken: {
            scope: {
              targetId: 1,
              targetLogin: "acme",
              permissions: { issues: "write", contents: "read" },
            },
          },
        }),
        "list",
      ),
    ).toBe("acme · all repositories · contents: read, issues: write");
  });

  it("counts repositories it knows only by id", () => {
    expect(
      connectionScopeSummary(
        view({
          githubUserToken: { scope: { targetId: 1, repositoryIds: [1, 2, 3] } },
        }),
      ),
    ).toBe("account 1 · 3 repositories · all permissions");
  });

  it("says all repositories and all permissions when only the account is narrowed", () => {
    expect(
      connectionScopeSummary(
        view({
          githubUserToken: { scope: { targetId: 1, targetLogin: "acme" } },
        }),
      ),
    ).toBe("acme · all repositories · all permissions");
  });

  // TEST_SCENARIO: an installation connection narrowed by repository id has no names of its own, so it shows the names its token was checked to reach.
  it("names the repositories an installation connection was checked to reach", () => {
    expect(
      connectionScopeSummary(
        view({
          authKind: "github-app",
          githubAppScope: { repositoryIds: [5, 6, 7, 8] },
          check: {
            status: "passed",
            at: "2026-10-26T00:00:00Z",
            installedOn: "acme",
            repositories: ["api", "web", "docs", "infra"],
          },
        }),
      ),
    ).toBe("acme · api, web, docs and 1 more · all permissions");
  });

  it("says nothing of scope for full access, which has its own line", () => {
    const app = view({ authKind: "github-app", fullAccess: true });
    expect(connectionScopeSummary(app)).toBeNull();
    expect(fullAccessLine(app)).toBe("Full access — the whole installation");
    expect(fullAccessLine(view({}))).toBe(
      "Full access — everything the app can reach on every account",
    );
  });
});

describe("connection row detail", () => {
  it("marks full access next to the account it acts as", () => {
    expect(
      connectionDetail(view({ accountLabel: "octocat", fullAccess: true })),
    ).toEqual({
      account: "Acts as octocat",
      reach: {
        text: "Full access — everything the app can reach on every account",
        fullAccess: true,
      },
    });
  });

  // TEST_SCENARIO: the row counts the permissions, and its tooltip lists them, so the line stays short and each permission can still be read on hover.
  it("lists the permissions in the tooltip of a row that counts them", () => {
    expect(
      connectionDetail(
        view({
          accountLabel: "octocat",
          githubUserToken: {
            scope: {
              targetId: 1,
              targetLogin: "acme",
              permissions: { issues: "write", contents: "read" },
            },
          },
        }),
      ),
    ).toEqual({
      account: "Acts as octocat",
      reach: {
        text: "acme · all repositories · 2 permissions",
        fullAccess: false,
        title: "acme · all repositories · contents: read, issues: write",
      },
    });
  });

  it("gives no tooltip of its own when no permission is narrowed", () => {
    expect(
      connectionDetail(
        view({
          githubUserToken: { scope: { targetId: 1, targetLogin: "acme" } },
        }),
      ),
    ).toEqual({
      reach: {
        text: "acme · all repositories · all permissions",
        fullAccess: false,
      },
    });
  });

  it("names the account an installation is on", () => {
    expect(
      connectionDetail(
        view({
          authKind: "github-app",
          isParent: true,
          check: { status: "passed", at: "x", installedOn: "acme" },
        }),
      ),
    ).toEqual({ account: "Installed on acme" });
  });
});

describe("appScopeChoice", () => {
  it("sends full access alone", () => {
    expect(
      appScopeChoice({
        access: "full",
        repositories: ["api"],
        repositoryIds: [1],
        permissions: { contents: "read" },
      }),
    ).toEqual({ fullAccess: true });
  });

  it("sends nothing while nothing is chosen", () => {
    expect(
      appScopeChoice({
        access: "narrowed",
        repositories: [],
        repositoryIds: [],
        permissions: {},
      }),
    ).toBeNull();
  });

  it("sends only the fields that hold something", () => {
    expect(
      appScopeChoice({
        access: "narrowed",
        repositories: [],
        repositoryIds: [9, 3],
        permissions: {},
      }),
    ).toEqual({ repositoryIds: "3 9" });
  });
});
