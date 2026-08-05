import { describe, expect, it, vi } from "vitest";
import { derivePrState } from "../../modules/skills/domain/pr-state.js";
import type {
  PodPrStateReader,
  PrDisposition,
} from "../../modules/skills/domain/pr-state.js";
import { parsePrUrl } from "../../modules/skills/domain/pr-url.js";
import {
  createPrStateResolver,
  groupByPrUrl,
} from "../../modules/skills/services/resolve-pr-state.js";
import type { AgentSkillsRepository } from "../../modules/skills/infrastructure/agent-skills-repository.js";
import type {
  PrStateReader,
  PrStateReadResult,
} from "../../modules/skills/infrastructure/pr-state-reader.js";

describe("derivePrState", () => {
  // GitHub reports a merged pull request as state:"closed" too, so mergedAt
  // must win over closed, and draft only matters while open.
  it.each([
    ["merged beats closed", "closed", false, "2026-08-01T00:00:00Z", "merged"],
    ["merged beats draft", "open", true, "2026-08-01T00:00:00Z", "merged"],
    ["closed without merge is closed", "closed", false, null, "closed"],
    ["closed ignores draft", "closed", true, null, "closed"],
    ["open draft is draft", "open", true, null, "draft"],
    ["open non-draft is open", "open", false, null, "open"],
  ] as const)("%s", (_label, state, draft, mergedAt, expected) => {
    expect(derivePrState({ state, draft, mergedAt })).toBe(expected);
  });
});

describe("parsePrUrl", () => {
  it("parses a GitHub pull request URL into coordinates", () => {
    expect(parsePrUrl("https://github.com/acme/skills/pull/42")).toEqual({
      owner: "acme",
      repo: "skills",
      number: 42,
    });
  });

  it("tolerates a trailing slash", () => {
    expect(parsePrUrl("https://github.com/acme/skills/pull/42/")).toEqual({
      owner: "acme",
      repo: "skills",
      number: 42,
    });
  });

  it.each([
    ["an enterprise host", "https://github.example.com/acme/skills/pull/42"],
    ["another forge", "https://gitlab.com/acme/skills/-/merge_requests/42"],
    ["a non-numeric ref", "https://github.com/acme/skills/pull/latest"],
    ["a non-PR GitHub URL", "https://github.com/acme/skills/issues/42"],
    ["junk", "not a url"],
  ])("returns null for %s", (_label, url) => {
    expect(parsePrUrl(url)).toBeNull();
  });
});

describe("groupByPrUrl", () => {
  it("keeps every publisher's agentId for one shared pull request", () => {
    expect(
      groupByPrUrl([
        { agentId: "a1", prUrl: "u1", prEtag: "e1" },
        { agentId: "a2", prUrl: "u1", prEtag: "e1" },
        { agentId: "a1", prUrl: "u2", prEtag: null },
      ]),
    ).toEqual([
      { prUrl: "u1", prEtag: "e1", agentIds: ["a1", "a2"] },
      { prUrl: "u2", prEtag: null, agentIds: ["a1"] },
    ]);
  });
});

const PR_URL = "https://github.com/acme/skills/pull/7";

function makeResolver(opts: {
  candidates: { agentId: string; prUrl: string; prEtag: string | null }[];
  reads?: PrStateReadResult[];
  podReads?: (PrDisposition | null)[];
}) {
  const agentSkills = {
    listPrStateCandidates: vi.fn().mockResolvedValue(opts.candidates),
    setPrState: vi.fn().mockResolvedValue(undefined),
    touchPrState: vi.fn().mockResolvedValue(undefined),
  } as unknown as AgentSkillsRepository;
  const read = vi.fn<PrStateReader["read"]>();
  for (const r of opts.reads ?? []) read.mockResolvedValueOnce(r);
  const podRead = vi.fn<PodPrStateReader["read"]>();
  for (const r of opts.podReads ?? []) podRead.mockResolvedValueOnce(r);
  const resolver = createPrStateResolver({
    agentSkills,
    reader: { read },
    podReader: { read: podRead },
    log: vi.fn(),
  });
  return { resolver, agentSkills, read, podRead };
}

const candidate = (
  agentId = "a1",
  prUrl = PR_URL,
  prEtag: string | null = null,
) => ({
  agentId,
  prUrl,
  prEtag,
});

describe("pr-state resolver tick", () => {
  it("writes a resolved state with its validator and reports it", async () => {
    const { resolver, agentSkills, read } = makeResolver({
      candidates: [candidate("a1", PR_URL, "etag-0")],
      reads: [{ kind: "state", prState: "open", etag: "etag-1" }],
    });

    await expect(resolver.tick()).resolves.toBe(1);
    expect(read).toHaveBeenCalledWith(
      { owner: "acme", repo: "skills", number: 7 },
      "etag-0",
    );
    expect(agentSkills.setPrState).toHaveBeenCalledWith(PR_URL, {
      prState: "open",
      checkedAt: expect.any(Date),
      etag: "etag-1",
    });
  });

  it("reads a shared pull request once, settling both agents' records", async () => {
    const { resolver, read } = makeResolver({
      candidates: [candidate("a1"), candidate("a2")],
      reads: [{ kind: "state", prState: "merged", etag: null }],
    });

    await expect(resolver.tick()).resolves.toBe(1);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("confirms on 304 — backoff resets, validator kept", async () => {
    const { resolver, agentSkills } = makeResolver({
      candidates: [candidate("a1", PR_URL, "etag-0")],
      reads: [{ kind: "notModified" }],
    });

    await expect(resolver.tick()).resolves.toBe(0);
    expect(agentSkills.touchPrState).toHaveBeenCalledWith(
      PR_URL,
      expect.any(Date),
      "confirmed",
    );
  });

  it("stops the whole pass on rate limit without stamping the failed record", async () => {
    const other = "https://github.com/acme/skills/pull/8";
    const { resolver, agentSkills, read } = makeResolver({
      candidates: [candidate("a1", PR_URL), candidate("a1", other)],
      reads: [{ kind: "unavailable", reason: "rate-limited" }],
    });

    await expect(resolver.tick()).resolves.toBe(0);
    // Every further read this window is certain to fail — one read, no touches.
    expect(read).toHaveBeenCalledTimes(1);
    expect(agentSkills.touchPrState).not.toHaveBeenCalled();
    expect(agentSkills.setPrState).not.toHaveBeenCalled();
  });

  it("escalates a 404 through each publisher's pod until a warm one answers", async () => {
    const { resolver, agentSkills, podRead } = makeResolver({
      candidates: [candidate("a1"), candidate("a2")],
      reads: [{ kind: "unavailable", reason: "not-found" }],
      podReads: [
        null,
        { state: "closed", draft: false, mergedAt: "2026-08-01T00:00:00Z" },
      ],
    });

    await expect(resolver.tick()).resolves.toBe(1);
    expect(podRead).toHaveBeenNthCalledWith(1, "a1", {
      owner: "acme",
      repo: "skills",
      number: 7,
    });
    expect(podRead).toHaveBeenNthCalledWith(2, "a2", {
      owner: "acme",
      repo: "skills",
      number: 7,
    });
    // The pod path reads no ETag back; the anonymous validator belongs to a
    // resource the anonymous read failed to see.
    expect(agentSkills.setPrState).toHaveBeenCalledWith(PR_URL, {
      prState: "merged",
      checkedAt: expect.any(Date),
      etag: null,
    });
  });

  it("stamps a failure when no pod can answer a 404", async () => {
    const { resolver, agentSkills } = makeResolver({
      candidates: [candidate("a1")],
      reads: [{ kind: "unavailable", reason: "not-found" }],
      podReads: [null],
    });

    await expect(resolver.tick()).resolves.toBe(0);
    expect(agentSkills.touchPrState).toHaveBeenCalledWith(
      PR_URL,
      expect.any(Date),
      "failed",
    );
  });

  it("stamps an unparsable URL as failed without spending a read", async () => {
    const { resolver, agentSkills, read } = makeResolver({
      candidates: [candidate("a1", "https://example.com/not-github")],
    });

    await expect(resolver.tick()).resolves.toBe(0);
    expect(read).not.toHaveBeenCalled();
    expect(agentSkills.touchPrState).toHaveBeenCalledWith(
      "https://example.com/not-github",
      expect.any(Date),
      "failed",
    );
  });

  it("never reads more than the per-tick cap", async () => {
    const candidates = Array.from({ length: 11 }, (_, i) =>
      candidate("a1", `https://github.com/acme/skills/pull/${i + 1}`),
    );
    const { resolver, read } = makeResolver({
      candidates,
      reads: candidates.map(() => ({
        kind: "unavailable" as const,
        reason: "error" as const,
      })),
    });

    await resolver.tick();
    expect(read).toHaveBeenCalledTimes(10);
  });
});
