// TEST_OVERVIEW: an agent shows the user a page by pasting the line `platform-browser open` prints — `[Open host](platform://browser?url=<encoded>)` — into its reply. The chat turns that link into a button that opens the browser panel on the page, and the panel navigates to it once, when it is ready.
import { describe, expect, test } from "vitest";
import { create } from "zustand";

import {
  browserLinkLabel,
  browserLinksIn,
  parseBrowserLink,
} from "../../modules/browser/lib/browser-link.js";
import { createBrowserSlice } from "../../modules/browser/store.js";
import type { PlatformStore } from "../../store.js";

describe("parseBrowserLink", () => {
  // TEST_SCENARIO: the command encodes the whole address into the link. The chat decodes it back, and accepts only web addresses, so a link an agent wrote by hand with `javascript:` or `file:` never becomes a button.
  test("decodes the address and keeps only web addresses", () => {
    expect(
      parseBrowserLink(
        `platform://browser?url=${encodeURIComponent("http://localhost:4444/")}`,
      ),
    ).toBe("http://localhost:4444/");
    expect(parseBrowserLink("platform://browser?url=localhost%3A3000")).toBe(
      "http://localhost:3000/",
    );
    expect(
      parseBrowserLink(
        `platform://browser?url=${encodeURIComponent("javascript:alert(1)")}`,
      ),
    ).toBeNull();
    expect(
      parseBrowserLink(
        `platform://browser?url=${encodeURIComponent("file:///etc/passwd")}`,
      ),
    ).toBeNull();
    expect(parseBrowserLink("platform://browser?url=%E0%A4%A")).toBeNull();
    expect(parseBrowserLink("https://example.com")).toBeNull();
    expect(parseBrowserLink(undefined)).toBeNull();
  });

  test("labels the button by host and path", () => {
    expect(browserLinkLabel("http://localhost:4444/")).toBe("localhost:4444");
    expect(browserLinkLabel("http://localhost:4444/admin")).toBe(
      "localhost:4444/admin",
    );
  });
});

describe("browserLinksIn", () => {
  // TEST_SCENARIO: agents often leave the line `platform-browser open` prints in the tool output instead of pasting it into their reply. The chat finds the link there, among the command's other output, so the panel can open and the button can show anyway; repeats collapse to one, and a broken link is skipped.
  test("finds the browser links in a command's output", () => {
    const out = [
      `[Open localhost:3000](platform://browser?url=${encodeURIComponent("http://localhost:3000/")})`,
      "✓ Done",
      `[Open localhost:3000](platform://browser?url=${encodeURIComponent("http://localhost:3000/")})`,
      `[Open x](platform://browser?url=${encodeURIComponent("file:///etc/passwd")})`,
      `[Open kiwi](platform://browser?url=${encodeURIComponent("https://www.kiwi.com/en/")})`,
    ].join("\n");
    expect(browserLinksIn(out)).toEqual([
      "http://localhost:3000/",
      "https://www.kiwi.com/en/",
    ]);
    expect(browserLinksIn("no links here")).toEqual([]);
  });
});

describe("browser open request", () => {
  // TEST_SCENARIO: clicking a button opens the panel and asks it to go to the page. The panel takes the request once; reopening the panel later must not send the user back to an old page.
  test("is taken once", () => {
    const store = create<PlatformStore>()(
      (...a) => createBrowserSlice(...a) as unknown as PlatformStore,
    );
    store.getState().setOpenBrowser("agent-1", "http://localhost:4444/");
    expect(store.getState().openBrowserAgentId).toBe("agent-1");
    expect(store.getState().takeBrowserOpenRequest()?.url).toBe(
      "http://localhost:4444/",
    );
    expect(store.getState().takeBrowserOpenRequest()).toBeNull();
    store.getState().setOpenBrowser("agent-1");
    expect(store.getState().takeBrowserOpenRequest()).toBeNull();
  });
});
