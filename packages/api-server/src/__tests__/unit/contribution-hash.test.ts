import { describe, it, expect } from "vitest";
import type { Contribution } from "api-server-api";
import { contributionHash } from "../../modules/runtime-delivery/domain/contribution-hash.js";

const env = (name: string, placeholder: string): Contribution => ({
  kind: "env",
  name,
  placeholder,
});

describe("contributionHash duplicate keys (#3143)", () => {
  it("is order-independent even for same-name contributions", () => {
    const a = env("SHARED", "one");
    const b = env("SHARED", "two");
    expect(contributionHash([a, b])).toBe(contributionHash([b, a]));
  });

  it("still distinguishes different values under the same name", () => {
    expect(contributionHash([env("SHARED", "one")])).not.toBe(
      contributionHash([env("SHARED", "two")]),
    );
  });
});
