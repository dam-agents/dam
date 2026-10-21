import { describe, expect, it } from "vitest";

import { renameDefaults } from "../../modules/sessions/lib/session-title.js";

// TEST_OVERVIEW: the rename dialog prefills only a title the user set, and shows the title the agent gave the session as its placeholder, so clearing the field goes back to the automatic title.

describe("renameDefaults", () => {
  // TEST_SCENARIO: a session nobody renamed opens the dialog empty, with the automatic title as the placeholder, so the user does not have to delete a long prompt-derived title first.
  it("leaves the field empty for an automatic title", () => {
    expect(
      renameDefaults({
        title: "Summarize the open pull requests and…",
        customTitle: null,
        autoTitle: "Summarize the open pull requests and…",
      }),
    ).toEqual({
      value: "",
      placeholder: "Summarize the open pull requests and…",
    });
  });

  it("prefills a title the user set", () => {
    expect(
      renameDefaults({
        title: "Daily brief",
        customTitle: "Daily brief",
        autoTitle: "Summarize the open pull requests",
      }),
    ).toEqual({
      value: "Daily brief",
      placeholder: "Summarize the open pull requests",
    });
  });

  // TEST_SCENARIO: an agent runtime that predates the title source sends only the merged title. The dialog then prefills it, as before, without the trailing ellipsis of a cut title.
  it("prefills the merged title when the source is unknown", () => {
    expect(renameDefaults({ title: "Fix the build…" })).toEqual({
      value: "Fix the build",
      placeholder: undefined,
    });
  });
});
