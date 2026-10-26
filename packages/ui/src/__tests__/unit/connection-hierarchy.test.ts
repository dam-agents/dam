// TEST_OVERVIEW: a GitHub sign-in or GitHub App installation holds the credential and is never granted to an agent; the connections made from it are. The Connections page lists each one with the connections made from it underneath. Names are unique among sign-ins and installations, and separately among connections, so a new sign-in is offered a name no other sign-in has, and a new connection made from it a name no other connection has.
import type { ConnectionTemplateView, ConnectionView } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  awaitingFirstConnection,
  childNameError,
  createChildHeading,
  defaultChildName,
  isGrantable,
  nestConnections,
  newParentNameRule,
  parentNoun,
} from "../../modules/connections/lib/connection-hierarchy.js";
import { templateFormDefaults } from "../../modules/connections/lib/template-form-schema.js";

const connection = (
  id: string,
  fields: Partial<ConnectionView> = {},
): ConnectionView =>
  ({
    id,
    name: id,
    authKind: "oauth",
    status: "active",
    ...fields,
  }) as ConnectionView;

const signIn = connection("gh", { isParent: true });
const narrowed = connection("gh-acme", { parentId: "gh" });
const full = connection("gh-full", { parentId: "gh", fullAccess: true });
const slack = connection("slack", { authKind: "header" });

describe("connection hierarchy", () => {
  it("never offers a sign-in or installation to an agent", () => {
    expect(isGrantable(signIn)).toBe(false);
    expect(isGrantable(narrowed)).toBe(true);
    expect(isGrantable(slack)).toBe(true);
  });

  it("lists the connections made from a sign-in under it, in list order", () => {
    expect(nestConnections([narrowed, slack, signIn, full])).toEqual([
      { connection: slack },
      { connection: signIn, children: [narrowed, full] },
    ]);
  });

  it("lists a sign-in with nothing made from it with no children", () => {
    expect(nestConnections([signIn])).toEqual([
      { connection: signIn, children: [] },
    ]);
  });

  // TEST_SCENARIO: an agent's page holds only the connections granted to it, never the sign-in they were made from, so each one stays an ordinary row.
  it("keeps a connection whose sign-in is not listed as an ordinary row", () => {
    expect(nestConnections([narrowed, full])).toEqual([
      { connection: narrowed },
      { connection: full },
    ]);
  });

  // TEST_SCENARIO: a sign-in that comes back from GitHub asks for its first connection only while it has none, so re-authenticating a sign-in that already has connections, or any other connection, asks nothing.
  it("asks for a first connection only for a sign-in that has none", () => {
    expect(awaitingFirstConnection("gh", [signIn])).toBe(signIn);
    expect(awaitingFirstConnection("gh", [signIn, narrowed])).toBeNull();
    expect(awaitingFirstConnection("slack", [slack])).toBeNull();
    expect(awaitingFirstConnection("gone", [signIn])).toBeNull();
  });

  it("names a sign-in and an installation in their own terms", () => {
    expect(parentNoun({ authKind: "oauth" })).toBe("GitHub sign-in");
    expect(parentNoun({ authKind: "github-app" })).toBe(
      "GitHub App installation",
    );
    expect(
      createChildHeading({
        authKind: "oauth",
        name: "gh",
        accountLabel: "octocat",
      }),
    ).toEqual({
      title: "What should this connection reach?",
      subtitle: "From the GitHub sign-in gh (octocat)",
    });
  });
});

describe("default name of a new connection", () => {
  it("takes the sign-in's name for its first connection", () => {
    expect(defaultChildName(signIn, [signIn])).toBe("gh");
  });

  it("takes the first free numbered name once one exists", () => {
    const second = connection("gh-2", { parentId: "gh" });
    expect(
      defaultChildName(signIn, [
        signIn,
        connection("c1", { name: "gh", parentId: "gh" }),
        second,
      ]),
    ).toBe("gh-3");
  });

  // TEST_SCENARIO: names are unique among connections only, so the sign-in's own name never counts as taken, but an unrelated connection with that name does.
  it("steps past a name another connection already holds", () => {
    expect(
      defaultChildName(signIn, [signIn, connection("x", { name: "gh" })]),
    ).toBe("gh-2");
  });

  it("keeps a long name within the 63-character limit", () => {
    const long = connection("long", {
      name: `${"a".repeat(61)}-b`,
      isParent: true,
    });
    const name = defaultChildName(long, [
      long,
      connection("c", { name: long.name, parentId: "long" }),
    ]);
    expect(name.length).toBeLessThanOrEqual(63);
    expect(name.endsWith("-2")).toBe(true);
  });

  it("refuses a name another connection holds, but not the sign-in's", () => {
    expect(childNameError("gh", [signIn])).toBeNull();
    expect(childNameError("gh-acme", [signIn, narrowed])).toMatch(
      /already have a connection/,
    );
    expect(childNameError("Not Valid", [])).not.toBeNull();
  });
});

describe("name of a new sign-in or installation", () => {
  const oauthTemplate: ConnectionTemplateView = {
    id: "github",
    name: "GitHub",
    category: "app",
    isCustom: false,
    authKind: "oauth",
    inputs: [],
  };
  const appTemplate: ConnectionTemplateView = {
    ...oauthTemplate,
    id: "github-app",
    authKind: "github-app",
  };

  it("steps past the names other sign-ins hold, not the names of connections", () => {
    const rule = newParentNameRule(oauthTemplate, [
      connection("s1", { name: "github", isParent: true }),
      connection("c1", { name: "github-2", parentId: "s1" }),
    ]);
    expect(templateFormDefaults(oauthTemplate, rule).name).toBe("github-2");
  });

  // TEST_SCENARIO: creating an installation with a reach also creates its first connection under the same name, so that name must be free among connections too.
  it("keeps an installation's name free among connections as well", () => {
    const rule = newParentNameRule(appTemplate, [
      connection("c1", { name: "github" }),
    ]);
    expect(templateFormDefaults(appTemplate, rule).name).toBe("github-2");
  });

  it("leaves every other template's name alone", () => {
    expect(
      newParentNameRule({ id: "github-pat", authKind: "header" }, [
        connection("c1", { name: "github" }),
      ]),
    ).toBeNull();
  });
});
