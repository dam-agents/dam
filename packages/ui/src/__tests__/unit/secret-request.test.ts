// TEST_OVERVIEW: the page a user types a connection secret on reads its request from the link, says where the secret goes in plain terms, and tells a user who opened another user's link not to enter a secret there. After the save it shows what the token check found, and a held secret says whether it failed the check, could not be checked, or passed but expires within a day.
import { describe, expect, it } from "vitest";

import {
  credentialCheckDetails,
  destinationDetail,
  destinationLabel,
  heldCheckCopy,
  readSecretRequestId,
  secretRequestErrorCopy,
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
