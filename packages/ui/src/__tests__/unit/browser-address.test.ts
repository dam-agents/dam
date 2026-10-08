// TEST_OVERVIEW: the browser panel's address bar takes what a user types the way a browser does: an address opens, with http added when it has no scheme, and anything else searches DuckDuckGo.
import { describe, expect, test } from "vitest";

import { addressUrl } from "../../modules/browser/lib/address.js";

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
