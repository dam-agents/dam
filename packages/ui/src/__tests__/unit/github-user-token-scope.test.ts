// TEST_OVERVIEW: what a GitHub sign-in connection's scope dialog sends. Full access is an explicit choice of its own; a narrowed choice needs an account before it sends anything, so ticking nothing never gives everything.
import { describe, expect, it } from "vitest";

import { userTokenScopeChoice } from "../../modules/connections/lib/github-user-token-scope.js";

describe("userTokenScopeChoice", () => {
  it("sends full access alone, whatever is ticked", () => {
    expect(
      userTokenScopeChoice({
        access: "full",
        targetId: 42,
        repositoryIds: new Set([7]),
        permissions: { contents: "read" },
      }),
    ).toEqual({ fullAccess: true });
  });

  it("sends nothing while a narrowed choice has no account", () => {
    expect(
      userTokenScopeChoice({
        access: "narrowed",
        targetId: null,
        repositoryIds: new Set([7]),
        permissions: { contents: "read" },
      }),
    ).toBeNull();
  });

  it("sends the account with its repositories and permissions", () => {
    expect(
      userTokenScopeChoice({
        access: "narrowed",
        targetId: 42,
        repositoryIds: new Set([9, 7]),
        permissions: { issues: "write", contents: "read" },
      }),
    ).toEqual({
      targetId: 42,
      repositoryIds: "7 9",
      permissions: "contents:read issues:write",
    });
  });

  it("sends the account alone when nothing else is ticked", () => {
    expect(
      userTokenScopeChoice({
        access: "narrowed",
        targetId: 42,
        repositoryIds: new Set(),
        permissions: {},
      }),
    ).toEqual({ targetId: 42 });
  });
});
