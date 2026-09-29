import { describe, expect, it } from "vitest";

import { acpSessionsKeys } from "../../modules/sessions/api/keys.js";

// TEST_OVERVIEW: the session list's query keys — one cache entry per set of session categories, whatever order the filter holds them in.

describe("acpSessionsKeys.pagesOf", () => {
  // TEST_SCENARIO: Turning a filter off and on again appends it to the end of the filter; the same set must keep its cache entry, so the pages loaded with "Show older sessions" stay.
  it("gives the same key to the same categories in any order", () => {
    expect(acpSessionsKeys.pagesOf("a", ["scheduled", "chats"])).toEqual(
      acpSessionsKeys.pagesOf("a", ["chats", "scheduled"]),
    );
  });
});
