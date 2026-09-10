// TEST_OVERVIEW: the sandbox's network is the egress boundary, so the two things that must hold are that each agent gets a link nobody else is on, and that the rendered ruleset never lets one off it. Both are pure functions of the agent set, which is what makes them checkable here rather than only in a booted VM.
import { describe, expect, it } from "vitest";
import {
  allocateIndex,
  indexOfAddress,
  linkFor,
  nftablesRuleset,
} from "../../modules/sandboxes/domain/network.js";

describe("sandbox links", () => {
  it("gives each index a distinct /30 with the gateway on .1 and the sandbox on .2", () => {
    expect(linkFor("a", 0)).toMatchObject({
      hostAddress: "100.64.0.1",
      sandboxAddress: "100.64.0.2",
      prefixLength: 30,
      netns: "dam-a",
    });
    expect(linkFor("b", 1)).toMatchObject({
      hostAddress: "100.64.0.5",
      sandboxAddress: "100.64.0.6",
    });
    expect(linkFor("c", 64).sandboxAddress).toBe("100.64.1.2");
  });

  // TEST_SCENARIO: two live agents on one /30 would put each on the other's gateway — the one way this model leaks a credential across agents.
  it("never hands out an index that is already live", () => {
    expect(allocateIndex([0, 1, 2])).toBe(3);
    expect(allocateIndex([0, 2])).toBe(1);
    expect(allocateIndex([])).toBe(0);
  });

  it("recovers an index from a published address, so a restart reuses the link", () => {
    for (const index of [0, 1, 7, 4095]) {
      expect(indexOfAddress(linkFor("x", index).sandboxAddress)).toBe(index);
    }
  });

  it("rejects an address that is not a sandbox end", () => {
    expect(indexOfAddress("100.64.0.1")).toBeNull();
    expect(indexOfAddress("10.0.0.2")).toBeNull();
  });

  it("refuses an index outside the pool rather than wrapping onto someone else", () => {
    expect(() => linkFor("x", -1)).toThrow(RangeError);
    expect(() => linkFor("x", 16_384)).toThrow(RangeError);
  });
});

describe("nftables ruleset", () => {
  const links = [linkFor("a", 0), linkFor("b", 1)];
  const ruleset = nftablesRuleset({
    links,
    gatewayPort: 3128,
    sandboxPort: 8080,
  });

  // TEST_SCENARIO: forwarding off the link is the one path that would let a sandbox reach the internet without passing its gateway, which is the whole credential boundary.
  it("drops forwarding off every sandbox link", () => {
    for (const link of links) {
      expect(ruleset).toContain(`iifname "${link.hostInterface}" drop`);
    }
    expect(ruleset).toContain("hook forward");
  });

  it("admits only each sandbox's own gateway address and port", () => {
    expect(ruleset).toContain(
      'iifname "damh0" ip saddr 100.64.0.2 ip daddr 100.64.0.1 tcp dport 3128 accept',
    );
    expect(ruleset).toContain(
      'iifname "damh1" ip saddr 100.64.0.6 ip daddr 100.64.0.5 tcp dport 3128 accept',
    );
  });

  it("ends every link's input rules with a drop, so the accept is the only way in", () => {
    const lines = ruleset.split("\n").map((l) => l.trim());
    const accept = lines.indexOf(
      'iifname "damh0" ip saddr 100.64.0.2 ip daddr 100.64.0.1 tcp dport 3128 accept',
    );
    expect(lines[accept + 1]).toBe('iifname "damh0" drop');
  });

  it("is empty of agent rules when no agent is running", () => {
    const empty = nftablesRuleset({ links: [], gatewayPort: 3128, sandboxPort: 8080 });
    expect(empty).not.toContain("iifname");
    expect(empty).toContain("table inet dam");
  });
});
