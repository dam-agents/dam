import { z } from "zod";
import { tokenize } from "agent-runtime-api/kb-snapshot";

export const SEARCH_INDEX_VERSION = 2;
export const BM25_K1 = 1.2;
export const BM25_B = 0.75;

export interface SearchIndex {
  version: number;
  docs: string[];
  docLengths: number[];
  postings: Record<string, [docIndex: number, termFrequency: number][]>;
  degraded: boolean;
}

export interface SearchHit {
  path: string;
  score: number;
}

const searchIndexSchema = z.object({
  version: z.literal(SEARCH_INDEX_VERSION),
  docs: z.array(z.string()),
  docLengths: z.array(z.number()),
  postings: z.record(z.string(), z.array(z.tuple([z.number(), z.number()]))),
  degraded: z.boolean(),
});

export function parseSearchIndex(raw: string): SearchIndex | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = searchIndexSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function querySearchIndex(
  index: SearchIndex,
  query: string,
  limit: number,
): SearchHit[] {
  const tokens = [...new Set(tokenize(query))];
  const n = index.docs.length;
  if (tokens.length === 0 || n === 0) return [];
  const totalLength = index.docLengths.reduce((sum, l) => sum + l, 0);
  const avgdl = totalLength / n || 1;

  const scores = new Map<number, number>();
  for (const token of tokens) {
    const list = Object.hasOwn(index.postings, token)
      ? index.postings[token]
      : undefined;
    if (!list || list.length === 0) continue;
    const df = list.length;
    const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
    for (const [docIndex, tf] of list) {
      const dl = index.docLengths[docIndex] ?? avgdl;
      const denom = tf + BM25_K1 * (1 - BM25_B + BM25_B * (dl / avgdl));
      const contribution = (idf * (tf * (BM25_K1 + 1))) / denom;
      scores.set(docIndex, (scores.get(docIndex) ?? 0) + contribution);
    }
  }
  return [...scores.entries()]
    .map(([docIndex, score]) => ({ path: index.docs[docIndex]!, score }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, limit);
}
