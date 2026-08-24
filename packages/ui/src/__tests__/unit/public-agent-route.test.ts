import { describe, expect, it } from "vitest";

import { ownerInitials } from "../../modules/agents/lib/owner-initials.js";
import {
  parsePublicAgentPath,
  publicAgentPath,
} from "../../modules/platform/lib/routes.js";

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

  /**
   * TEST_SCENARIO: The chat and agent-home routes build this path to redirect a
   * visitor who cannot read the agent. If the builder and the matcher disagreed
   * on encoding, that redirect would land on a path main.tsx refuses and the
   * visitor would be sent to Keycloak instead of the page.
   */
  it("builds a path the matcher claims and reads back as the same id", () => {
    for (const agentId of [
      "agent-1148bc3d6914e918",
      "agent with spaces",
      "agent/../escape",
    ]) {
      expect(parsePublicAgentPath(publicAgentPath(agentId))).toBe(agentId);
    }
  });
});

describe("owner initials", () => {
  /**
   * TEST_SCENARIO: The byline avatar is built from the owner's display name,
   * which Keycloak gives us as a first and a last name joined by a space.
   */
  it("takes one letter from the first and last word of the name", () => {
    expect(ownerInitials("Radek Jezek")).toBe("RJ");
    expect(ownerInitials("Tomas Weiss")).toBe("TW");
    expect(ownerInitials("Ana Maria Silva Costa")).toBe("AC");
  });

  /**
   * TEST_SCENARIO: A one-word name has no last word, and an empty result would
   * leave a blank circle on the page.
   */
  it("falls back to one letter for a single-word name", () => {
    expect(ownerInitials("Admin")).toBe("A");
  });

  /**
   * TEST_SCENARIO: Owner names are not ASCII-only. Indexing bytes rather than
   * code points would cut a multi-byte letter in half.
   */
  it("keeps accented letters whole", () => {
    expect(ownerInitials("Žofie Černá")).toBe("ŽČ");
  });
});
