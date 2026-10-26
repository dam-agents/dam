// TEST_OVERVIEW: the page a user types a connection secret on reads its request from the link, says where the secret goes in plain terms, and tells a user who opened another user's link not to enter a secret there. For a new GitHub App installation it says what the connection reaches, or that the save stores the installation only; for an installation it never presents the agents of the connections made from it as its own. After the save it shows what the token check found, and a held secret says whether it failed the check, could not be checked, or passed but expires within a day.
import type { SecretRequestView } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  credentialCheckDetails,
  destinationDetail,
  destinationLabel,
  grantFailedCopy,
  heldCheckCopy,
  readSecretRequestId,
  secretRequestErrorCopy,
  secretRequestReach,
  secretRequestSubjectLabel,
  secretRequestUsedBy,
} from "../../modules/connections/lib/secret-request.js";

describe("secret request page", () => {
  it("reads the request id from the link", () => {
    expect(readSecretRequestId("?request=abc_-1")).toBe("abc_-1");
    expect(readSecretRequestId("?request=")).toBeNull();
    expect(readSecretRequestId("")).toBeNull();
  });

  // TEST_SCENARIO: the user sees the exact header the gateway sends, with the secret's place marked, and the port when the host has one.
  it("shows the header with the secret's place marked", () => {
    const d = {
      host: "api.github.com",
      headerName: "Authorization",
      valueFormat: "Bearer {value}",
    };
    expect(destinationLabel(d)).toBe("api.github.com");
    expect(destinationDetail(d)).toBe("Authorization: Bearer <secret>");
    expect(destinationLabel({ host: "k8s.example", port: 6443 })).toBe(
      "k8s.example:6443",
    );
    expect(destinationDetail({ host: "s3.example", signed: true })).toBe(
      "requests signed with the key pair",
    );
  });

  // TEST_SCENARIO: a link made on another account is the phishing case, so its copy warns the user off rather than only saying the link failed.
  it("warns off a link from another user", () => {
    expect(secretRequestErrorCopy("FORBIDDEN").hint).toMatch(
      /Never enter a secret on a link someone else sent you/,
    );
    expect(secretRequestErrorCopy("NOT_FOUND").title).toMatch(/expired/);
  });

  // TEST_SCENARIO: a passed check names the account, the expiry and the scopes, so the user sees they pasted the right token; an empty scope list reads as none, not as a missing line.
  it("lists what a passed check found", () => {
    expect(
      credentialCheckDetails({
        status: "passed",
        account: "octocat",
        scopes: [],
        at: "2026-10-22T08:00:00.000Z",
      }),
    ).toEqual(["Account: octocat", "Scopes: none"]);
    expect(
      credentialCheckDetails({
        status: "passed",
        expiresAt: "2026-11-21T10:00:00.000Z",
        at: "2026-10-22T08:00:00.000Z",
      }),
    ).toEqual([expect.stringMatching(/^Expires: .*2026/)]);
  });

  // TEST_SCENARIO: a GitHub App check names the bot, the account the app is installed on and the repositories its token reaches, and marks a list it could not read whole.
  it("lists what a GitHub App check found", () => {
    expect(
      credentialCheckDetails({
        status: "passed",
        account: "dam-bot[bot]",
        installedOn: "dam-agents",
        repositories: ["docs", "web"],
        repositoriesTruncated: true,
        at: "2026-10-22T08:00:00.000Z",
      }),
    ).toEqual([
      "Account: dam-bot[bot]",
      "Installed on: dam-agents",
      "Repositories: docs, web, …",
    ]);
  });

  // TEST_SCENARIO: a failed check and a check that could not run are told apart, since only the first says the secret is wrong.
  it("tells a failed check from one that could not run", () => {
    const at = "2026-10-22T08:00:00.000Z";
    expect(heldCheckCopy({ status: "failed", at }).title).toMatch(
      /did not pass/,
    );
    expect(heldCheckCopy({ status: "unchecked", at }).title).toMatch(
      /could not be checked/,
    );
  });

  // TEST_SCENARIO: a token that passes but expires within a day, such as a service-account token EKS shortened to 24 hours, is held with its own warning, so the user sees it before agents start failing the next day.
  it("warns of a token that expires within a day", () => {
    const at = "2026-10-22T08:00:00.000Z";
    const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const later = new Date(Date.now() + 30 * 86_400_000).toISOString();
    expect(
      heldCheckCopy({ status: "passed", expiresAt: soon, at }).title,
    ).toMatch(/expires within a day/);
    expect(
      heldCheckCopy({ status: "passed", expiresAt: later, at }).title,
    ).not.toMatch(/expires/);
  });
});

describe("what a new GitHub App installation reaches", () => {
  const create = { action: "create", authKind: "github-app" } as const;

  it("marks full access", () => {
    expect(
      secretRequestReach({ ...create, githubAppAccess: { fullAccess: true } }),
    ).toEqual({
      kind: "full-access",
      text: "Full access — the whole installation",
    });
  });

  it("says the repositories and permissions", () => {
    expect(
      secretRequestReach({
        ...create,
        githubAppAccess: {
          repositories: ["docs"],
          permissions: { contents: "read" },
        },
      }),
    ).toEqual({ kind: "scope", text: "docs · contents: read" });
  });

  // TEST_SCENARIO: a request with no reach stores the installation alone, which no agent can hold, so the page must not promise the agent that asked for it.
  it("says the save stores the installation only when nothing is chosen", () => {
    expect(secretRequestReach(create)).toEqual({ kind: "installation-only" });
    expect(
      secretRequestReach({ ...create, githubAppAccess: { repositories: [] } }),
    ).toEqual({ kind: "installation-only" });
  });

  it("says nothing for another kind of request", () => {
    expect(
      secretRequestReach({ action: "update", authKind: "github-app" }),
    ).toBeNull();
    expect(
      secretRequestReach({ action: "create", authKind: "header" }),
    ).toBeNull();
  });
});

describe("a secret request for a GitHub App installation", () => {
  const installationOnly: Pick<
    SecretRequestView,
    "action" | "authKind" | "grantedAgents" | "requestedBy"
  > = {
    action: "create",
    authKind: "github-app",
    grantedAgents: [],
    requestedBy: { id: "a1", name: "triage" },
  };

  // TEST_SCENARIO: an agent asked for an installation with no reach, so the save gives it nothing; the page must send the user to make a connection from the installation, not to grant the installation, which the server refuses.
  it("tells the user to make a connection when the asking agent got nothing", () => {
    expect(grantFailedCopy(installationOnly)).toMatch(
      /Make a connection from the GitHub App installation on the Connections page/,
    );
    expect(
      grantFailedCopy({
        ...installationOnly,
        githubAppAccess: { fullAccess: true },
      }),
    ).toMatch(/Grant the connection in the agent's Connections section/);
  });

  it("names the installation and says no agent uses it yet", () => {
    expect(secretRequestSubjectLabel(installationOnly)).toBe(
      "GitHub App installation",
    );
    expect(secretRequestUsedBy(installationOnly)).toEqual({
      label: "Used by",
      text: "no agent until you make a connection from it",
    });
  });

  it("lists the agents of its connections when its key is replaced", () => {
    expect(
      secretRequestUsedBy({
        action: "update",
        authKind: "github-app",
        isParent: true,
        grantedAgents: [{ id: "a1", name: "triage" }],
      }),
    ).toEqual({ label: "Used by (through its connections)", text: "triage" });
  });
});
