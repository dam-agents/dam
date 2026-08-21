import { describe, expect, it } from "vitest";

import { ownerInitials } from "../../modules/agents/lib/owner-initials.js";
import { parsePublicAgentPath } from "../../modules/platform/lib/routes.js";

/**
 * TEST_OVERVIEW: The public agent page is the one route that renders without a
 * signed-in user, and main.tsx decides that from the pathname alone before
 * initAuth runs. So the matcher is a security boundary, not a convenience: a
 * path it wrongly claims renders anonymously, and a path it wrongly rejects
 * bounces a stranger to Keycloak.
 */

describe("public agent path", () => {
  /**
   * TEST_SCENARIO: The Slack footer link is the only producer of this path, and
   * it carries the session as a query param that the pathname matcher must
   * ignore.
   */
  it("matches the agent page path", () => {
    expect(parsePublicAgentPath("/a/agent-1148bc3d6914e918")).toBe(
      "agent-1148bc3d6914e918",
    );
    expect(parsePublicAgentPath("/a/agent-1148bc3d6914e918/")).toBe(
      "agent-1148bc3d6914e918",
    );
  });

  /**
   * TEST_SCENARIO: Every one of these is an authenticated surface. If the matcher
   * claimed any of them, the app would render it to an anonymous visitor with no
   * token instead of sending them to log in.
   */
  it("claims nothing that belongs to the signed-in app", () => {
    for (const path of [
      "/",
      "/a",
      "/a/",
      "/artifacts",
      "/agents",
      "/chat/agent-1",
      "/chat/agent-1/session-1",
      "/a/agent-1/extra",
      "/inbox",
      "/settings/account",
      "/auth/callback",
    ]) {
      expect(parsePublicAgentPath(path)).toBeNull();
    }
  });

  /**
   * TEST_SCENARIO: The id reaches the matcher percent-encoded from the address
   * bar and goes straight into an API path, so it has to come back decoded once
   * and only once.
   */
  it("decodes the agent id", () => {
    expect(parsePublicAgentPath("/a/agent%2D1")).toBe("agent-1");
  });
});

describe("owner initials", () => {
  /**
   * TEST_SCENARIO: The byline avatar is built from the owner's email because the
   * directory gives us no display name. Real subs produce dotted local parts.
   */
  it("takes one letter from the first and last word of the local part", () => {
    expect(ownerInitials("radek.jezek@example.com")).toBe("RJ");
    expect(ownerInitials("tomas.weiss2@example.com")).toBe("TW");
    expect(ownerInitials("first.middle.last@example.com")).toBe("FL");
  });

  /**
   * TEST_SCENARIO: A mononym local part has no last word, and an empty result
   * would leave a blank circle on the page.
   */
  it("falls back to one letter for a single-word local part", () => {
    expect(ownerInitials("admin@example.com")).toBe("A");
  });

  /**
   * TEST_SCENARIO: Owner emails are not ASCII-only. Indexing bytes rather than
   * code points would cut a multi-byte letter in half.
   */
  it("keeps accented letters whole", () => {
    expect(ownerInitials("žofie.černá@example.com")).toBe("ŽČ");
  });
});
