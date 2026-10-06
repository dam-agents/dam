// TEST_OVERVIEW: an agent shows the user a page with `platform-browser open`, which prints `[Open host](platform://browser?url=<encoded>&at=<ms>)`. The chat turns that link into a button that opens the browser panel on the page, opens the panel by itself when the link is fresh, and the panel navigates to it once, when it is ready.
import { describe, expect, test } from "vitest";
import { create } from "zustand";

import {
  browserLinkLabel,
  browserLinksIn,
  isFreshLink,
  parseBrowserLink,
} from "../../modules/browser/lib/browser-link.js";
import { createBrowserSlice } from "../../modules/browser/store.js";
import type { PlatformStore } from "../../store.js";

describe("parseBrowserLink", () => {
  // TEST_SCENARIO: the command encodes the whole address into the link, and stamps it with when it ran. The chat decodes both, and accepts only web addresses, so a link an agent wrote by hand with `javascript:` or `file:` never becomes a button.
  test("decodes the address and its stamp, and keeps only web addresses", () => {
    expect(
      parseBrowserLink(
        `platform://browser?url=${encodeURIComponent("http://localhost:4444/")}&at=1700000000000`,
      ),
    ).toEqual({ url: "http://localhost:4444/", at: 1_700_000_000_000 });
    expect(parseBrowserLink("platform://browser?url=localhost%3A3000")).toEqual(
      {
        url: "http://localhost:3000/",
        at: null,
      },
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

describe("isFreshLink", () => {
  // TEST_SCENARIO: the panel opens by itself only for a page the agent opened just now. A link stamped minutes ago — an old conversation, a reload — opens nothing, and so does a link with no stamp, which an agent wrote by hand.
  test("is fresh only within two minutes of its stamp", () => {
    const now = 1_700_000_000_000;
    expect(isFreshLink({ url: "http://a/", at: now - 5_000 }, now)).toBe(true);
    expect(isFreshLink({ url: "http://a/", at: now - 10 * 60_000 }, now)).toBe(
      false,
    );
    expect(isFreshLink({ url: "http://a/", at: null }, now)).toBe(false);
  });
});

describe("browserLinksIn", () => {
  // TEST_SCENARIO: agents often leave the line `platform-browser open` prints in the tool output instead of pasting it into their reply. The chat finds the link there, among the command's other output, so the panel can open anyway; repeats collapse to one, and a broken link is skipped.
  test("finds the browser links in a command's output", () => {
    const local = `platform://browser?url=${encodeURIComponent("http://localhost:3000/")}&at=5`;
    const out = [
      `[Open localhost:3000](${local})`,
      "✓ Done",
      `[Open localhost:3000](${local})`,
      `[Open x](platform://browser?url=${encodeURIComponent("file:///etc/passwd")})`,
      `[Open kiwi](platform://browser?url=${encodeURIComponent("https://www.kiwi.com/en/")})`,
    ].join("\n");
    expect(browserLinksIn(out)).toEqual([
      { url: "http://localhost:3000/", at: 5 },
      { url: "https://www.kiwi.com/en/", at: null },
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

describe("maximized browser", () => {
  // TEST_SCENARIO: the panel can fill the whole agent view; closing it must bring the chat back, so the next panel opens docked rather than maximized.
  test("is reset when the panel closes", () => {
    const store = create<PlatformStore>()(
      (...a) => createBrowserSlice(...a) as unknown as PlatformStore,
    );
    store.getState().setOpenBrowser("agent-1");
    store.getState().setBrowserMaximized(true);
    expect(store.getState().browserMaximized).toBe(true);
    store.getState().setOpenBrowser(null);
    expect(store.getState().browserMaximized).toBe(false);
  });
});
