import { describe, expect, it, vi } from "vitest";
import { derivePrState } from "../../modules/skills/domain/pr-state.js";
import type {
  PodPrReadResult,
  PodPrStateReader,
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
        { agentId: "a1", prUrl: "u2" },
      ]),
    ).toEqual([
      { prUrl: "u1", prEtag: "e1", agentIds: ["a1", "a2"] },
      { prUrl: "u2", prEtag: null, agentIds: ["a1"] },
    ]);
  });
});

const PR_URL = "https://github.com/acme/skills/pull/7";

function makeResolver(opts: {
  candidates?: { agentId: string; prUrl: string; prEtag: string | null }[];
  podCandidates?: { agentId: string; prUrl: string }[];
  runningAgentIds?: string[];
  reads?: PrStateReadResult[];
  podReads?: PodPrReadResult[];
}) {
  const agentSkills = {
    listPrStateCandidates: vi.fn().mockResolvedValue(opts.candidates ?? []),
    listPodPrStateCandidates: vi
      .fn()
      .mockResolvedValue(opts.podCandidates ?? []),
    setPrState: vi.fn().mockResolvedValue(undefined),
    touchPrState: vi.fn().mockResolvedValue(undefined),
    markPrNeedsPod: vi.fn().mockResolvedValue(undefined),
  } as unknown as AgentSkillsRepository;
  const read = vi.fn<PrStateReader["read"]>();
  for (const r of opts.reads ?? []) read.mockResolvedValueOnce(r);
  const podRead = vi.fn<PodPrStateReader["read"]>();
  for (const r of opts.podReads ?? []) podRead.mockResolvedValueOnce(r);
  const listRunningAgentIds = vi
    .fn()
    .mockResolvedValue(opts.runningAgentIds ?? []);
  const resolver = createPrStateResolver({
    agentSkills,
    reader: { read },
    podReader: { read: podRead },
    listRunningAgentIds,
    log: vi.fn(),
  });
  return { resolver, agentSkills, read, podRead, listRunningAgentIds };
}

const candidate = (
  agentId = "a1",
  prUrl = PR_URL,
  prEtag: string | null = null,
) => ({ agentId, prUrl, prEtag });

const podCandidate = (agentId = "a1", prUrl = PR_URL) => ({ agentId, prUrl });

describe("pr-state resolver tick — anonymous pass", () => {
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

  it("marks a 404 for the pod lane without stamping or reading pods inline", async () => {
    const { resolver, agentSkills, podRead } = makeResolver({
      candidates: [candidate("a1")],
      reads: [{ kind: "unavailable", reason: "not-found" }],
    });

    await expect(resolver.tick()).resolves.toBe(0);
    // Only `not-found` marks; the record leaves the anonymous lane for good.
    expect(agentSkills.markPrNeedsPod).toHaveBeenCalledWith(PR_URL);
    // No verdict was reached, so neither the clock nor the counter moves.
    expect(agentSkills.touchPrState).not.toHaveBeenCalled();
    // Pod reads belong to the pod pass, which sees this record once the DB
    // returns it as a pod-lane candidate.
    expect(podRead).not.toHaveBeenCalled();
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

  it("never reads more than the anonymous per-tick cap", async () => {
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

  it("stops the anonymous pass on rate limit but still runs the pod pass", async () => {
    const other = "https://github.com/acme/skills/pull/8";
    const { resolver, agentSkills, read, podRead } = makeResolver({
      candidates: [candidate("a1", PR_URL), candidate("a1", other)],
      reads: [{ kind: "unavailable", reason: "rate-limited" }],
      podCandidates: [podCandidate("a2", "https://github.com/acme/p/pull/9")],
      runningAgentIds: ["a2"],
      podReads: [
        {
          kind: "state",
          disposition: { state: "open", draft: false, mergedAt: null },
        },
      ],
    });

    // Every further anonymous read this window is certain to fail — one
    // read, no stamp for the rate-limited record. The pod pass spends
    // nothing anonymous, so it proceeds regardless.
    await expect(resolver.tick()).resolves.toBe(1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(agentSkills.touchPrState).not.toHaveBeenCalled();
    expect(podRead).toHaveBeenCalledTimes(1);
  });
});

describe("pr-state resolver tick — pod pass", () => {
  it("resolves a pod-lane record through a warm publisher, spending nothing anonymous", async () => {
    const { resolver, agentSkills, read, podRead } = makeResolver({
      podCandidates: [podCandidate("a1")],
      runningAgentIds: ["a1"],
      podReads: [
        {
          kind: "state",
          disposition: {
            state: "closed",
            draft: false,
            mergedAt: "2026-08-01T00:00:00Z",
          },
        },
      ],
    });

    await expect(resolver.tick()).resolves.toBe(1);
    expect(read).not.toHaveBeenCalled();
    expect(podRead).toHaveBeenCalledWith("a1", {
      owner: "acme",
      repo: "skills",
      number: 7,
    });
    // The pod path reads no ETag back; any anonymous validator belongs to a
    // resource the anonymous read failed to see.
    expect(agentSkills.setPrState).toHaveBeenCalledWith(PR_URL, {
      prState: "merged",
      checkedAt: expect.any(Date),
      etag: null,
    });
  });

  it("tries each warm publisher until one answers", async () => {
    const { resolver, agentSkills, podRead } = makeResolver({
      podCandidates: [podCandidate("a1"), podCandidate("a2")],
      runningAgentIds: ["a1", "a2"],
      podReads: [
        { kind: "failed" },
        {
          kind: "state",
          disposition: { state: "open", draft: false, mergedAt: null },
        },
      ],
    });

    await expect(resolver.tick()).resolves.toBe(1);
    expect(podRead).toHaveBeenCalledTimes(2);
    // A success settles the record; the earlier warm failure is not stamped.
    expect(agentSkills.touchPrState).not.toHaveBeenCalled();
  });

  it("skips a record whose publishers are all cold, without any stamp", async () => {
    const { resolver, agentSkills, podRead } = makeResolver({
      podCandidates: [podCandidate("a1")],
      runningAgentIds: [],
    });

    await expect(resolver.tick()).resolves.toBe(0);
    // Nothing attempted, nothing learned: no read, no clock, no counter —
    // the record keeps its place until a warm sample or agent deletion.
    expect(podRead).not.toHaveBeenCalled();
    expect(agentSkills.touchPrState).not.toHaveBeenCalled();
    expect(agentSkills.setPrState).not.toHaveBeenCalled();
  });

  it("treats a pod that hibernated after the warmth check as cold, not failed", async () => {
    const { resolver, agentSkills } = makeResolver({
      podCandidates: [podCandidate("a1")],
      runningAgentIds: ["a1"],
      podReads: [{ kind: "not-running" }],
    });

    await expect(resolver.tick()).resolves.toBe(0);
    expect(agentSkills.touchPrState).not.toHaveBeenCalled();
  });

  it("stamps a real failure when a warm pod could not answer", async () => {
    const { resolver, agentSkills } = makeResolver({
      podCandidates: [podCandidate("a1")],
      runningAgentIds: ["a1"],
      podReads: [{ kind: "failed" }],
    });

    await expect(resolver.tick()).resolves.toBe(0);
    expect(agentSkills.touchPrState).toHaveBeenCalledWith(
      PR_URL,
      expect.any(Date),
      "failed",
    );
  });

  it("never checks the cluster when there are no pod-lane candidates", async () => {
    const { resolver, listRunningAgentIds } = makeResolver({
      candidates: [candidate()],
      reads: [{ kind: "state", prState: "open", etag: null }],
    });

    await resolver.tick();
    // An idle pod lane costs one DB query and nothing else.
    expect(listRunningAgentIds).not.toHaveBeenCalled();
  });

  it("caps pod reads per tick, leaving the rest for the next one", async () => {
    const podCandidates = Array.from({ length: 30 }, (_, i) =>
      podCandidate("a1", `https://github.com/acme/skills/pull/${i + 1}`),
    );
    const { resolver, podRead } = makeResolver({
      podCandidates,
      runningAgentIds: ["a1"],
      podReads: podCandidates.map(() => ({ kind: "failed" as const })),
    });

    await resolver.tick();
    expect(podRead).toHaveBeenCalledTimes(25);
  });
});
