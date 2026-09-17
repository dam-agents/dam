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
  const bytes = Buffer.byteLength(payload, "utf8");
  return (bytes + 4).toString(16).padStart(4, "0") + payload;
}

function advertisement(body: string): Buffer {
  return Buffer.from(body, "utf8");
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

function resolverReturning(body: string, status = 200) {
  return createGitRefResolver(
    (async () =>
      new Response(status === 200 ? body : null, {
        status,
      })) as unknown as typeof fetch,
  );
}

describe("starter kits: git ref resolver", () => {
  it("reads HEAD, branches and tags out of the advertisement", () => {
    const parsed = parseRefAdvertisement(advertisement(ADVERTISEMENT));
    expect(parsed.head).toBe(HEAD_SHA);
    expect(parsed.refs.get("refs/heads/next")).toBe(BRANCH_SHA);
  });

  it("prefers the commit an annotated tag points at over the tag object", () => {
    const parsed = parseRefAdvertisement(advertisement(ADVERTISEMENT));
    expect(parsed.refs.get("refs/tags/v1.4.0")).toBe(TAG_COMMIT);
  });

  // TEST_SCENARIO: git allows UTF-8 ref names, and a pkt-line's length is a byte count. A parser that walks the decoded text instead drifts by the extra bytes of the first such name, reads the rest of the advertisement out of frame, and answers that refs which exist are absent — which the refresh reads as the author withdrawing those kits.
  it("stays in frame across a non-ASCII ref name", () => {
    const body = advertisement(
      pkt(`${HEAD_SHA} HEAD\n`) +
        pkt(`${BRANCH_SHA} refs/heads/f\u00e9ature-\u00e9t\u00e9\n`) +
        pkt(`${TAG_COMMIT} refs/heads/after\n`) +
        "0000",
    );
    const parsed = parseRefAdvertisement(body);
    expect(parsed.refs.get("refs/heads/féature-été")).toBe(BRANCH_SHA);
    expect(parsed.refs.get("refs/heads/after")).toBe(TAG_COMMIT);
  });

  it("resolves a branch, a tag, an omitted ref and a sha", async () => {
    const resolver = resolverReturning(ADVERTISEMENT);
    const url = "https://github.com/acme/kit";
    expect(await resolver.resolve(url, "next")).toEqual({
      status: "resolved",
      sha: BRANCH_SHA,
    });
    expect(await resolver.resolve(url, "v1.4.0")).toEqual({
      status: "resolved",
      sha: TAG_COMMIT,
    });
    expect(await resolver.resolve(url)).toEqual({
      status: "resolved",
      sha: HEAD_SHA,
    });
    expect(await resolver.resolve(url, HEAD_SHA)).toEqual({
      status: "resolved",
      sha: HEAD_SHA,
    });
  });

  // TEST_SCENARIO: the caller prunes on a settled no and holds every stored row otherwise, so those answers must not arrive as the same empty value. A repository that answered, and did not advertise the ref, has settled it. A url this reader will not serve has too.
  it("settles a ref the repository answered for, and a url it will not serve", async () => {
    const resolver = resolverReturning(ADVERTISEMENT);
    expect(
      await resolver.resolve("https://github.com/acme/kit", "nope"),
    ).toEqual({ status: "absent" });
    expect(await resolver.resolve("https://example.com/acme/kit")).toEqual({
      status: "absent",
    });
  });

  // TEST_SCENARIO: a repository that answers 404 is one this reader cannot see — deleted, renamed, or made private — and none of those is the author withdrawing a kit. Reading it as a settled absence prunes every kit of that catalog, so renaming a repository would empty the kit list. It holds instead, like any other unanswered read.
  it("holds a repository it cannot see, rather than withdrawing its kits", async () => {
    for (const status of [404, 410, 502]) {
      expect(
        await resolverReturning(ADVERTISEMENT, status).resolve(
          "https://github.com/acme/kit",
        ),
      ).toEqual({ status: "unreachable" });
    }
  });
});
