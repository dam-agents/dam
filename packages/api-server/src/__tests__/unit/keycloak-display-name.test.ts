import { describe, expect, it } from "vitest";
import { toDirectoryUser } from "../../modules/agents/infrastructure/keycloak-user-directory.js";

/**
 * TEST_OVERVIEW: The owner byline on the Public Agent Page is the one place a
 * directory record is shown to a visitor with no login, so these specs pin what
 * a record turns into: a name when Keycloak holds one, and nothing at all when
 * it does not. The email is never a fallback — it is a real mailbox, and the
 * page it would appear on is a link pasted into shared Slack conversations.
 */
describe("keycloak display name", () => {
  /**
   * TEST_SCENARIO: The usual record. Keycloak stores the two names apart, and
   * the byline reads "Created by <name>", so they arrive joined by a space.
   */
  it("joins the first and last name", () => {
    expect(
      toDirectoryUser({
        email: "radek.jezek@example.com",
        firstName: "Radek",
        lastName: "Jezek",
      }),
    ).toEqual({ email: "radek.jezek@example.com", displayName: "Radek Jezek" });
  });

  /**
   * TEST_SCENARIO: An identity provider that sends only one of the two names
   * still gives us something to show, and it must not arrive with the missing
   * half's whitespace attached.
   */
  it("uses whichever name is present on its own", () => {
    expect(toDirectoryUser({ firstName: "Radek" }).displayName).toBe("Radek");
    expect(toDirectoryUser({ lastName: "Jezek" }).displayName).toBe("Jezek");
  });

  /**
   * TEST_SCENARIO: Names are optional in Keycloak and blank strings come back
   * from providers that map an empty claim. Both mean the page has no owner to
   * name, and the byline is omitted rather than filled with the email.
   */
  it("has no display name when both names are missing or blank", () => {
    expect(
      toDirectoryUser({ email: "radek.jezek@example.com" }).displayName,
    ).toBeNull();
    expect(
      toDirectoryUser({ firstName: "  ", lastName: "" }).displayName,
    ).toBeNull();
  });
});
