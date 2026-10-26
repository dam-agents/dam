// TEST_OVERVIEW: an OAuth sign-in that returns by redirect instead of a popup carries the connection in the link, so the app can ask what the first connection made from a new GitHub sign-in reaches.
import { describe, expect, it } from "vitest";

import { signedInConnectionId } from "../../modules/connections/lib/oauth-return.js";

describe("sign-in return", () => {
  it("reads the connection of a successful sign-in", () => {
    expect(signedInConnectionId("?oauth=success&connection=c1")).toBe("c1");
  });

  it("reads nothing from a failed sign-in or an ordinary link", () => {
    expect(signedInConnectionId("?oauth=error&message=x")).toBeNull();
    expect(signedInConnectionId("?oauth=success")).toBeNull();
    expect(signedInConnectionId("")).toBeNull();
  });
});
