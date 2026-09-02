import type { IndexSegment } from "agent-runtime-api/kb-snapshot";
import { tokenize } from "agent-runtime-api/kb-snapshot";

import { BM25_B, BM25_K1, type SearchHit } from "./legacy-search-index.js";

export function querySegments(
  segments: readonly IndexSegment[],
  query: string,
  limit: number,
): SearchHit[] {
  const tokens = [...new Set(tokenize(query))];
  const live = segments.filter((s) => !s.degraded);
  const n = live.reduce((sum, s) => sum + s.docs.length, 0);
  if (tokens.length === 0 || n === 0) return [];
  const totalLength = live.reduce(
    (sum, s) => sum + s.docLengths.reduce((a, l) => a + l, 0),
    0,
  );
  const avgdl = totalLength / n || 1;

  const scores = new Map<string, number>();
  for (const token of tokens) {
    let df = 0;
    for (const seg of live) {
      const list = Object.hasOwn(seg.postings, token)
        ? seg.postings[token]
        : undefined;
      if (list) df += list.length / 2;
    }
    if (df === 0) continue;
    const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
    for (const seg of live) {
      const list = Object.hasOwn(seg.postings, token)
        ? seg.postings[token]
        : undefined;
      if (!list) continue;
      for (let i = 0; i + 1 < list.length; i += 2) {
        const docIndex = list[i]!;
        const tf = list[i + 1]!;
        const dl = seg.docLengths[docIndex] ?? avgdl;
        const denom = tf + BM25_K1 * (1 - BM25_B + BM25_B * (dl / avgdl));
        const contribution = (idf * (tf * (BM25_K1 + 1))) / denom;
        const path = seg.docs[docIndex];
        if (path === undefined) continue;
        scores.set(path, (scores.get(path) ?? 0) + contribution);
      }
    }
  }
  return [...scores.entries()]
    .map(([path, score]) => ({ path, score }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, limit);
}
