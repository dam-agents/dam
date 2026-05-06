import { describe, expect, it } from "vitest";
import { parsePeerSpiffe } from "../../apps/harness-api-server/peer-identity.js";

const TD = "cluster.local";
const NS = "platform-agents";

describe("parsePeerSpiffe", () => {
  it("extracts SA name from a single XFCC entry", () => {
    const xfcc =
      `By=spiffe://${TD}/ns/platform/sa/api-server;` +
      `Hash=abc;` +
      `URI=spiffe://${TD}/ns/${NS}/sa/my-instance`;
    expect(parsePeerSpiffe(xfcc, TD, NS)).toBe("my-instance");
  });

  it("uses the LAST entry when multiple hops are present", () => {
    // The last entry is the closest hop (the inbound peer); earlier entries
    // are upstream proxies whose identity must not be mistaken for the peer.
    const xfcc =
      `URI=spiffe://${TD}/ns/${NS}/sa/upstream-hop,` +
      `By=spiffe://${TD}/ns/platform/sa/api-server;` +
      `URI=spiffe://${TD}/ns/${NS}/sa/inbound-peer`;
    expect(parsePeerSpiffe(xfcc, TD, NS)).toBe("inbound-peer");
  });

  it("tolerates quoted Subject containing a comma", () => {
    const xfcc =
      `Subject="CN=x,O=acme";` +
      `URI=spiffe://${TD}/ns/${NS}/sa/quoted-friend`;
    expect(parsePeerSpiffe(xfcc, TD, NS)).toBe("quoted-friend");
  });

  it("rejects mismatched trust domain", () => {
    const xfcc = `URI=spiffe://other.example/ns/${NS}/sa/foo`;
    expect(parsePeerSpiffe(xfcc, TD, NS)).toBeNull();
  });

  it("rejects principals from a different namespace", () => {
    const xfcc = `URI=spiffe://${TD}/ns/some-other-ns/sa/foo`;
    expect(parsePeerSpiffe(xfcc, TD, NS)).toBeNull();
  });

  it("rejects malformed SPIFFE URI", () => {
    expect(parsePeerSpiffe(`URI=spiffe://${TD}/sa/foo`, TD, NS)).toBeNull();
    expect(parsePeerSpiffe(`URI=https://${TD}/ns/${NS}/sa/foo`, TD, NS)).toBeNull();
  });

  it("returns null on missing or empty header", () => {
    expect(parsePeerSpiffe(undefined, TD, NS)).toBeNull();
    expect(parsePeerSpiffe(null, TD, NS)).toBeNull();
    expect(parsePeerSpiffe("", TD, NS)).toBeNull();
  });

  it("returns null when XFCC has no URI key", () => {
    const xfcc = `By=spiffe://${TD}/ns/platform/sa/api-server;Hash=abc`;
    expect(parsePeerSpiffe(xfcc, TD, NS)).toBeNull();
  });
});
