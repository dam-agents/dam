// TEST_OVERVIEW: an agent shows the user a page by writing `[Open host](platform://browser?url=<encoded>&at=<ms>)` in its reply, as its `agent-browser` skill teaches. The chat turns that link into a button that opens the browser panel on the page, opens the panel by itself when the link is fresh, and the panel navigates to it once, when it is ready.
import { describe, expect, test } from "vitest";
import { create } from "zustand";

import {
  browserLinkLabel,
  isFreshLink,
  mayAutoOpen,
  parseBrowserLink,
  streamPageReload,
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

describe("mayAutoOpen", () => {
  const link = { url: "http://a/", at: 1_000_000 };
  const now = 1_000_000 + 10_000;

  // TEST_SCENARIO: a fresh link the agent just wrote opens the panel by itself, but never over an unsaved file or artifact draft in the docked slot: nobody asked for the panel, so nobody is asked to discard the draft. It waits, and opens once the draft is gone if the link is still fresh; a link it already opened stays opened.
  test("waits while a draft is unsaved, and opens a fresh link once", () => {
    expect(
      mayAutoOpen(link, { now, draftOpen: false, alreadyOpened: false }),
    ).toBe(true);
    expect(
      mayAutoOpen(link, { now, draftOpen: true, alreadyOpened: false }),
    ).toBe(false);
    expect(
      mayAutoOpen(link, { now, draftOpen: false, alreadyOpened: true }),
    ).toBe(false);
    expect(
      mayAutoOpen(link, {
        now: link.at + 3 * 60_000,
        draftOpen: false,
        alreadyOpened: false,
      }),
    ).toBe(false);
  });
});

describe("streamPageReload", () => {
  // TEST_SCENARIO: the stream page authenticates with the token in its address and reconnects by reloading that address. Once the access token has been renewed, the page must be loaded again with the new one, or every reconnect after the old one expires is refused; while the token is unchanged nothing is reloaded.
  test("reloads the stream page only with a renewed token", () => {
    expect(streamPageReload("agent 1", null, "t1")).toBe(
      "/api/public/browser-stream/agent%201/index.html?token=t1",
    );
    expect(streamPageReload("agent 1", "t1", "t1")).toBeNull();
    expect(streamPageReload("agent 1", "t1", "t2")).toBe(
      "/api/public/browser-stream/agent%201/index.html?token=t2",
    );
  });
});
