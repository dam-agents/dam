// TEST_OVERVIEW: the browser panel's toolbar talks to the agent's browser over a control socket: it sends the addresses and searches the user types, and is told the page's address, title, loading and history, and whether the browser is starting, ready or failed.
import { describe, expect, test } from "vitest";

import {
  addressUrl,
  parseControlMessage,
} from "../../modules/browser/lib/control.js";

describe("addressUrl", () => {
  // TEST_SCENARIO: a user types a dev server the way they would in a browser — `localhost:3000`, which a URL parser reads as the scheme `localhost:`. Anything without `<scheme>://` gets http, so it opens instead of being refused as a non-web address.
  test("adds http to an address without a scheme", () => {
    expect(addressUrl("localhost:3000")).toBe("http://localhost:3000");
    expect(addressUrl(" 127.0.0.1:4444/x ")).toBe("http://127.0.0.1:4444/x");
    expect(addressUrl("example.com")).toBe("http://example.com");
    expect(addressUrl("https://github.com/login")).toBe(
      "https://github.com/login",
    );
    expect(addressUrl("localhost")).toBe("http://localhost");
    expect(addressUrl("[::1]:8080/x")).toBe("http://[::1]:8080/x");
    expect(addressUrl("   ")).toBeNull();
  });

  // TEST_SCENARIO: like any browser's address bar, words that are not an address — one word, a phrase, a question that happens to contain a dot — search with DuckDuckGo instead of failing as an address.
  test("searches DuckDuckGo for anything that is not an address", () => {
    expect(addressUrl("selkies")).toBe("https://duckduckgo.com/?q=selkies");
    expect(addressUrl(" what is example.com ")).toBe(
      "https://duckduckgo.com/?q=what%20is%20example.com",
    );
    expect(addressUrl("c++ & rust")).toBe(
      "https://duckduckgo.com/?q=c%2B%2B%20%26%20rust",
    );
  });
});

describe("parseControlMessage", () => {
  // TEST_SCENARIO: the runtime keeps the panel connected while the browser starts, restarts or fails, and says which with a browser_state message; the panel shows a spinner or the failure from it. An unknown state or message is ignored rather than shown.
  test("reads url updates, browser state and errors, and ignores the rest", () => {
    const page = {
      url: "http://a/",
      title: "A",
      loading: true,
      canGoBack: true,
      canGoForward: false,
    };
    expect(
      parseControlMessage(JSON.stringify({ type: "page", ...page })),
    ).toEqual({ type: "page", ...page });
    expect(
      parseControlMessage('{"type":"page","url":"http://a/","loading":"yes"}'),
    ).toBeNull();
    expect(
      parseControlMessage('{"type":"preview_error","message":"no"}'),
    ).toEqual({ type: "preview_error", message: "no" });
    expect(
      parseControlMessage(
        '{"type":"browser_state","state":"failed","message":"Chrome exited"}',
      ),
    ).toEqual({
      type: "browser_state",
      state: "failed",
      message: "Chrome exited",
    });
    expect(
      parseControlMessage('{"type":"browser_state","state":"ready"}'),
    ).toEqual({ type: "browser_state", state: "ready", message: null });
    expect(
      parseControlMessage('{"type":"browser_state","state":"exploded"}'),
    ).toBeNull();
    expect(parseControlMessage('{"type":"status"}')).toBeNull();
    expect(parseControlMessage("{")).toBeNull();
  });
});
