import { describe, it, expect } from "vitest";
import { channelNetworkAccessGuidance } from "../../modules/channels/infrastructure/network-access-copy.js";

describe("channel network-access guidance", () => {
  it("names where approval happens, in the install's own brand", () => {
    const text = channelNetworkAccessGuidance("Acme");

    expect(text.match(/Acme/g)).toHaveLength(2);
    expect(text).not.toContain("undefined");
  });

  it("is a self-delimited block so it can be concatenated into any prompt", () => {
    const text = channelNetworkAccessGuidance("Acme");

    expect(text.startsWith("<network-access>")).toBe(true);
    expect(text.trimEnd().endsWith("</network-access>")).toBe(true);
  });

  it("states the symptom, the reason, and the recovery", () => {
    const text = channelNetworkAccessGuidance("Acme");

    expect(text).toContain("closed connection");
    expect(text).toContain("403");
    expect(text).toContain("cannot be approved from this conversation");
    expect(text).toContain("already waiting");
  });
});
