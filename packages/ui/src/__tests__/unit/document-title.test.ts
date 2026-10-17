// TEST_OVERVIEW: the browser tab title names the page, then its parent (the
// TEST_OVERVIEW: settings area or the agent), then the brand, joined by " · ".
// TEST_OVERVIEW: A name that has not loaded is left out, never shown as an id.
import { describe, expect, test } from "vitest";

import { documentTitle } from "../../lib/document-title.js";

const base = { settingsTab: "account" as const };

describe("documentTitle", () => {
  test("names a settings tab under Settings", () => {
    expect(
      documentTitle({ view: "settings", settingsTab: "api-keys" }, {}, "Brand"),
    ).toBe("API keys · Settings · Brand");
  });

  test("names a chat by its session title and agent", () => {
    expect(
      documentTitle(
        { ...base, view: "chat" },
        { agent: "Jeeves", session: "Fix the build" },
        "Brand",
      ),
    ).toBe("Fix the build · Jeeves · Brand");
  });

  // TEST_SCENARIO: a new chat has no session title yet and the agent list may still be loading; the title shows what is known and no empty segments.
  test("drops names that are not known yet", () => {
    expect(
      documentTitle({ ...base, view: "chat" }, { session: null }, "Brand"),
    ).toBe("Brand");
    expect(
      documentTitle({ ...base, view: "chat" }, { agent: "Jeeves" }, "Brand"),
    ).toBe("Jeeves · Brand");
  });

  test("names an agent config section under the agent", () => {
    expect(
      documentTitle(
        {
          ...base,
          view: "sandbox-home",
          sandboxSectionTitle: "Network access",
        },
        { agent: "Jeeves" },
        "Brand",
      ),
    ).toBe("Network access · Jeeves · Brand");
  });

  test("names Home", () => {
    expect(documentTitle({ ...base, view: "home" }, {}, "Brand")).toBe(
      "Home · Brand",
    );
  });
});
