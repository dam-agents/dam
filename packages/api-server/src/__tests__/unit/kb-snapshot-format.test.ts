import { describe, expect, it } from "vitest";

import {
  INDEX_FORMAT_VERSION,
  bucketForPath,
  buildSegment,
  chooseBucketCount,
  parseManifest,
  parseSegment,
  segmentContentId,
  tokenize,
  type IndexSegment,
} from "agent-runtime-api/kb-snapshot";

import {
  SEARCH_INDEX_VERSION,
  querySearchIndex,
  type SearchIndex,
} from "../../modules/kb-shares/domain/legacy-search-index.js";
import { querySegments } from "../../modules/kb-shares/domain/segmented-query.js";

/**
 * TEST_OVERVIEW: pins the shared kb-snapshot format that is compiled into both
 * the api-server and the agent-runtime images: manifest parsing across
 * versions, deterministic bucketing and segment content ids (the carry-forward
 * contract), the bounded segment builder, and BM25 parity between the legacy
 * single-index scorer and the segmented scorer.
 */

const CORPUS = [
  {
    path: "wiki/index.md",
    text: "The magic word is amaranth. Pages about gardens and plants.",
  },
  {
    path: "wiki/guides/plants.md",
    text: "Gardens contain plants. A plant grows tall. amaranth amaranth",
  },
  {
    path: "sources/notes.txt",
    text: "notes about many gardens and pages of notes",
  },
];

function toLegacyIndex(segment: IndexSegment): SearchIndex {
  const postings: SearchIndex["postings"] = {};
  for (const [token, flat] of Object.entries(segment.postings)) {
    const pairs: [number, number][] = [];
    for (let i = 0; i + 1 < flat.length; i += 2) {
      pairs.push([flat[i]!, flat[i + 1]!]);
    }
    postings[token] = pairs;
  }
  return {
    version: SEARCH_INDEX_VERSION,
    docs: segment.docs,
    docLengths: segment.docLengths,
    postings,
    degraded: segment.degraded,
  };
}

describe("tokenize", () => {
  // TEST_SCENARIO: plural stemming folds pages/page and ies->y so build-side and query-side needles agree.
  it("stems plurals consistently", () => {
    expect(tokenize("Pages page PAGES")).toEqual(["page", "page", "page"]);
    expect(tokenize("libraries")).toEqual(["library"]);
    expect(tokenize("glass classes")).toEqual(["glass", "classe"]);
  });
});

describe("bucketForPath", () => {
  // TEST_SCENARIO: bucketing is deterministic and in-range — the carry-forward diff depends on it never moving between runs.
  it("is stable, in range, and trivial for one bucket", () => {
    for (const file of CORPUS) {
      const bucket = bucketForPath(file.path, 8);
      expect(bucket).toBe(bucketForPath(file.path, 8));
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(8);
      expect(bucketForPath(file.path, 1)).toBe(0);
    }
  });
});

describe("chooseBucketCount", () => {
  // TEST_SCENARIO: small corpora stay single-segment, large ones grow as powers of two, and a previous count inside the hysteresis band is reused.
  it("targets ~4MiB per segment with hysteresis", () => {
    expect(chooseBucketCount(100_000)).toBe(1);
    const large = chooseBucketCount(100 * 1024 * 1024);
    expect(large).toBeGreaterThan(1);
    expect(Math.log2(large) % 1).toBe(0);
    expect(chooseBucketCount(6 * 1024 * 1024, 2)).toBe(2);
    expect(chooseBucketCount(100 * 1024 * 1024, 2)).toBeGreaterThan(2);
  });
});

describe("segmentContentId", () => {
  // TEST_SCENARIO: the content id is order-insensitive over members but changes with any member hash or the bucket count — the exact carry-forward equality.
  it("keys on members and bucket count only", () => {
    const members = [
      { path: "a.md", contentHash: "h1" },
      { path: "b.md", contentHash: "h2" },
    ];
    const reversed = [...members].reverse();
    expect(segmentContentId(members, 4)).toBe(segmentContentId(reversed, 4));
    expect(segmentContentId(members, 4)).not.toBe(
      segmentContentId(members, 8),
    );
    expect(segmentContentId(members, 4)).not.toBe(
      segmentContentId([{ path: "a.md", contentHash: "h9" }, members[1]!], 4),
    );
  });
});

describe("buildSegment", () => {
  // TEST_SCENARIO: the builder emits sorted docs with flat [docIndex, tf] postings and survives a JSON round-trip through parseSegment.
  it("builds flat postings and round-trips", () => {
    const segment = buildSegment(CORPUS);
    expect(segment.version).toBe(INDEX_FORMAT_VERSION);
    expect(segment.degraded).toBe(false);
    expect(segment.docs).toEqual([...segment.docs].sort());
    expect(segment.docs).toHaveLength(CORPUS.length);
    const amaranth = segment.postings["amaranth"];
    expect(amaranth).toBeDefined();
    expect(amaranth!.length % 2).toBe(0);
    const parsed = parseSegment(JSON.stringify(segment));
    expect(parsed).toEqual(segment);
  });

  // TEST_SCENARIO: blowing the byte budget degrades to a postings-free segment that still lists every doc, instead of growing without bound.
  it("degrades over budget without dropping docs", () => {
    const segment = buildSegment(CORPUS, 16);
    expect(segment.degraded).toBe(true);
    expect(segment.docs).toHaveLength(CORPUS.length);
    expect(segment.postings).toEqual({});
    expect(segment.docLengths.every((l) => l === 0)).toBe(true);
  });
});

describe("parseManifest", () => {
  // TEST_SCENARIO: both manifest generations parse and an unknown version returns null rather than a half-typed object.
  it("accepts v1 and v2, rejects unknown versions", () => {
    const shared = {
      snapshotId: "s1",
      createdAt: "2026-08-26T00:00:00.000Z",
      roots: ["wiki"],
      files: [
        { path: "wiki/index.md", sizeBytes: 10, contentHash: "h", key: "k" },
      ],
      documentCount: 1,
      totalSizeBytes: 10,
    };
    const v1 = parseManifest(
      JSON.stringify({ ...shared, version: 1, searchIndexKey: "ik" }),
    );
    expect(v1?.version).toBe(1);
    const v2 = parseManifest(
      JSON.stringify({
        ...shared,
        version: 2,
        search: {
          formatVersion: INDEX_FORMAT_VERSION,
          bucketCount: 1,
          segments: [
            {
              bucket: 0,
              key: "sk",
              contentId: "cid",
              docCount: 1,
              sizeBytes: 5,
              degraded: false,
            },
          ],
        },
      }),
    );
    expect(v2?.version).toBe(2);
    expect(parseManifest(JSON.stringify({ ...shared, version: 9 }))).toBeNull();
    expect(parseManifest("not json")).toBeNull();
  });
});

describe("querySegments parity", () => {
  // TEST_SCENARIO: the segmented scorer reproduces the legacy single-index BM25 exactly — same global stats, same ordering, same scores.
  it("matches querySearchIndex on the same corpus", () => {
    const single = buildSegment(CORPUS);
    const legacy = toLegacyIndex(single);
    for (const query of ["amaranth", "gardens plants", "notes pages magic"]) {
      const legacyHits = querySearchIndex(legacy, query, 5);
      const segmentedHits = querySegments([single], query, 5);
      expect(segmentedHits.map((h) => h.path)).toEqual(
        legacyHits.map((h) => h.path),
      );
      for (const [i, hit] of segmentedHits.entries()) {
        expect(hit.score).toBeCloseTo(legacyHits[i]!.score, 10);
      }
    }
  });

  // TEST_SCENARIO: splitting the corpus across buckets must not change ranking — global df/N/avgdl are aggregated across segments.
  it("is invariant under bucketing", () => {
    const bucketCount = 2;
    const grouped = new Map<number, typeof CORPUS>();
    for (const file of CORPUS) {
      const bucket = bucketForPath(file.path, bucketCount);
      grouped.set(bucket, [...(grouped.get(bucket) ?? []), file]);
    }
    const segments = [...grouped.values()].map((files) => buildSegment(files));
    const whole = buildSegment(CORPUS);
    for (const query of ["amaranth", "gardens plants"]) {
      const split = querySegments(segments, query, 5);
      const together = querySegments([whole], query, 5);
      expect(split.map((h) => h.path)).toEqual(together.map((h) => h.path));
      for (const [i, hit] of split.entries()) {
        expect(hit.score).toBeCloseTo(together[i]!.score, 10);
      }
    }
  });

  // TEST_SCENARIO: a degraded segment is excluded from ranking without erroring.
  it("skips degraded segments", () => {
    const good = buildSegment([CORPUS[0]!]);
    const bad = buildSegment([CORPUS[1]!], 8);
    const hits = querySegments([good, bad], "amaranth", 5);
    expect(hits.map((h) => h.path)).toEqual(["wiki/index.md"]);
  });
});
