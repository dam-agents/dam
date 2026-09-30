import { describe, expect, it } from "vitest";

import { userTokenScopePayload } from "../../modules/connections/lib/github-user-token-scope.js";

describe("userTokenScopePayload", () => {
  it("sends only the id when no account is chosen, which clears the scope", () => {
    expect(
      userTokenScopePayload("conn-1", {
        targetId: null,
        repositoryIds: new Set([7]),
        permissions: { contents: "read" },
      }),
    ).toEqual({ id: "conn-1" });
  });

  it("sends the account with its repositories and permissions", () => {
    expect(
      userTokenScopePayload("conn-1", {
        targetId: 42,
        repositoryIds: new Set([9, 7]),
        permissions: { issues: "write", contents: "read" },
      }),
    ).toEqual({
      id: "conn-1",
      targetId: 42,
      repositoryIds: "7 9",
      permissions: "contents:read issues:write",
    });
  });
});
