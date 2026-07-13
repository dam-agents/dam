import { HttpProxyAgent } from "http-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import { describe, expect, it } from "vitest";

import { proxyAgentForUrl } from "../modules/shared/ws-proxy.js";

describe("proxyAgentForUrl", () => {
  it("returns undefined when no proxy env var is set", () => {
    expect(proxyAgentForUrl("wss://api.example.com/x", {})).toBeUndefined();
  });

  it("uses HTTPS_PROXY for a wss target", () => {
    const agent = proxyAgentForUrl("wss://api.example.com/x", {
      HTTPS_PROXY: "http://proxy:10000",
    });
    expect(agent).toBeInstanceOf(HttpsProxyAgent);
  });

  it("uses HTTP_PROXY for a ws target", () => {
    const agent = proxyAgentForUrl("ws://api.example.com/x", {
      HTTP_PROXY: "http://proxy:10000",
    });
    expect(agent).toBeInstanceOf(HttpProxyAgent);
  });

  it("accepts lowercase env var names", () => {
    const agent = proxyAgentForUrl("wss://api.example.com/x", {
      https_proxy: "http://proxy:10000",
    });
    expect(agent).toBeInstanceOf(HttpsProxyAgent);
  });

  it("does not use HTTP_PROXY for a secure target", () => {
    // A wss target must not fall back to HTTP_PROXY — only HTTPS_PROXY applies.
    expect(
      proxyAgentForUrl("wss://api.example.com/x", {
        HTTP_PROXY: "http://proxy:10000",
      }),
    ).toBeUndefined();
  });

  it("skips proxying when the host matches NO_PROXY", () => {
    expect(
      proxyAgentForUrl("wss://api.internal.example.com/x", {
        HTTPS_PROXY: "http://proxy:10000",
        NO_PROXY: "localhost,.internal.example.com",
      }),
    ).toBeUndefined();
  });

  it("matches NO_PROXY entries case-insensitively", () => {
    expect(
      proxyAgentForUrl("wss://api.internal.example.com/x", {
        HTTPS_PROXY: "http://proxy:10000",
        NO_PROXY: ".Internal.Example.com",
      }),
    ).toBeUndefined();
  });

  it("honors a NO_PROXY wildcard", () => {
    expect(
      proxyAgentForUrl("wss://api.example.com/x", {
        HTTPS_PROXY: "http://proxy:10000",
        NO_PROXY: "*",
      }),
    ).toBeUndefined();
  });

  it("still proxies a host not covered by NO_PROXY", () => {
    const agent = proxyAgentForUrl("wss://api.example.com/x", {
      HTTPS_PROXY: "http://proxy:10000",
      NO_PROXY: "localhost,.other.example.com",
    });
    expect(agent).toBeInstanceOf(HttpsProxyAgent);
  });

  it("returns undefined for an unparseable url", () => {
    expect(
      proxyAgentForUrl("not-a-url", { HTTPS_PROXY: "http://proxy:10000" }),
    ).toBeUndefined();
  });
});
