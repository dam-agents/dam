import { describe, expect, it } from "vitest";
import {
  createGitRefResolver,
  parseRefAdvertisement,
} from "../../modules/starter-kits/infrastructure/git-ref-resolver.js";

const HEAD_SHA = "bddfcfd599baf30730faeca7d6355f8ec9a4ff66";
const TAG_OBJECT = "1111111111111111111111111111111111111111";
const TAG_COMMIT = "2222222222222222222222222222222222222222";
const BRANCH_SHA = "3333333333333333333333333333333333333333";

function pkt(payload: string): string {
  return (payload.length + 4).toString(16).padStart(4, "0") + payload;
}

const ADVERTISEMENT =
  pkt("# service=git-upload-pack\n") +
  "0000" +
  pkt(
    `${HEAD_SHA} HEAD\0multi_ack thin-pack symref=HEAD:refs/heads/main object-format=sha1\n`,
  ) +
  pkt(`${HEAD_SHA} refs/heads/main\n`) +
  pkt(`${BRANCH_SHA} refs/heads/next\n`) +
  pkt(`${TAG_OBJECT} refs/tags/v1.4.0\n`) +
  pkt(`${TAG_COMMIT} refs/tags/v1.4.0^{}\n`) +
  "0000";

function resolverReturning(body: string, ok = true) {
  return createGitRefResolver((async () => ({
    ok,
    arrayBuffer: async () => Buffer.from(body, "utf8"),
  })) as unknown as typeof fetch);
}

describe("starter kits: git ref resolver", () => {
  it("reads HEAD, branches and tags out of the advertisement", () => {
    const parsed = parseRefAdvertisement(ADVERTISEMENT);
    expect(parsed.head).toBe(HEAD_SHA);
    expect(parsed.refs.get("refs/heads/next")).toBe(BRANCH_SHA);
  });

  it("prefers the commit an annotated tag points at over the tag object", () => {
    const parsed = parseRefAdvertisement(ADVERTISEMENT);
    expect(parsed.refs.get("refs/tags/v1.4.0")).toBe(TAG_COMMIT);
  });

  it("resolves a branch, a tag, an omitted ref and a sha", async () => {
    const resolver = resolverReturning(ADVERTISEMENT);
    const url = "https://github.com/acme/kit";
    expect(await resolver.resolve(url, "next")).toBe(BRANCH_SHA);
    expect(await resolver.resolve(url, "v1.4.0")).toBe(TAG_COMMIT);
    expect(await resolver.resolve(url)).toBe(HEAD_SHA);
    expect(await resolver.resolve(url, HEAD_SHA)).toBe(HEAD_SHA);
  });

  it("returns null for an unknown ref, a non-GitHub url and a failed read", async () => {
    const resolver = resolverReturning(ADVERTISEMENT);
    expect(await resolver.resolve("https://github.com/acme/kit", "nope")).toBe(
      null,
    );
    expect(await resolver.resolve("https://example.com/acme/kit")).toBe(null);
    expect(
      await resolverReturning(ADVERTISEMENT, false).resolve(
        "https://github.com/acme/kit",
      ),
    ).toBe(null);
  });
});
