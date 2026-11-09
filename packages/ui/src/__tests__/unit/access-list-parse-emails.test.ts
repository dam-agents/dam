// TEST_OVERVIEW: what the access list's add dialog reads from the text an operator types or pastes. Addresses split by commas, semicolons, spaces or new lines are each lowercased and kept once, and any piece that is not an email address is handed back so the dialog can name it.
import { describe, expect, it } from "vitest";

import { parseEmails } from "../../modules/access-list/lib/parse-emails.js";

describe("parseEmails", () => {
  // TEST_SCENARIO: a pasted list in mixed separators and case gives each address once, lowercased, in the order typed.
  it("reads a pasted list", () => {
    expect(
      parseEmails("Ada@Example.com, bob@example.com;\ncy@x.io  ada@example.com"),
    ).toEqual({
      emails: ["ada@example.com", "bob@example.com", "cy@x.io"],
      invalid: [],
    });
  });

  // TEST_SCENARIO: a piece that is not an email address comes back apart, and empty text gives nothing.
  it("hands back what is not an email", () => {
    expect(parseEmails("ada@example.com nope")).toEqual({
      emails: ["ada@example.com"],
      invalid: ["nope"],
    });
    expect(parseEmails("  \n ")).toEqual({ emails: [], invalid: [] });
  });
});
