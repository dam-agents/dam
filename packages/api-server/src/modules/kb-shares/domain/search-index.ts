import { z } from "zod";

export const SEARCH_INDEX_VERSION = 2;
export const SEARCH_INDEX_MAX_BYTES = 32 * 1024 * 1024;
const TOKEN_PATTERN = /[a-z0-9_]+/g;
const TOKEN_MAX_CHARS = 64;
const BM25_K1 = 1.2;
const BM25_B = 0.75;

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

export function searchIndexKey(shareId: string, snapshotId: string): string {
  return `kb-snapshots/${shareId}/${snapshotId}/index.json`;
}

function stem(token: string): string {
  if (token.length > 4 && token.endsWith("ies"))
    return `${token.slice(0, -3)}y`;
  if (
    token.length > 4 &&
    (token.endsWith("ses") ||
      token.endsWith("xes") ||
      token.endsWith("zes") ||
      token.endsWith("ches") ||
      token.endsWith("shes"))
  ) {
    return token.slice(0, -2);
  }
  if (
    token.length > 3 &&
    token.endsWith("s") &&
    !token.endsWith("ss") &&
    !token.endsWith("us") &&
    !token.endsWith("is")
  ) {
    return token.slice(0, -1);
  }
  return token;
}

export function tokenize(text: string): string[] {
  const tokens = text.toLowerCase().match(TOKEN_PATTERN) ?? [];
  const out: string[] = [];
  for (const t of tokens) {
    if (t.length <= TOKEN_MAX_CHARS) out.push(stem(t));
  }
  return out;
}

export interface SearchIndexBuilder {
  add(path: string, text: string): void;
  finalize(): SearchIndex;
}

export function createSearchIndexBuilder(): SearchIndexBuilder {
  const docs: string[] = [];
  const docLengths: number[] = [];
  const postings = new Map<string, [number, number][]>();
  let approximateBytes = 0;
  let degraded = false;

  return {
    add(path, text) {
      const docIndex = docs.length;
      docs.push(path);
      approximateBytes += path.length + 8;
      if (degraded) {
        docLengths.push(0);
        return;
      }
      const tokens = tokenize(text);
      docLengths.push(tokens.length);
      const frequencies = new Map<string, number>();
      for (const token of tokens) {
        frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
      }
      for (const [token, tf] of frequencies) {
        const list = postings.get(token);
        if (list) {
          list.push([docIndex, tf]);
          approximateBytes += 12;
        } else {
          postings.set(token, [[docIndex, tf]]);
          approximateBytes += token.length + 16;
        }
        if (approximateBytes > SEARCH_INDEX_MAX_BYTES) {
          degraded = true;
          return;
        }
      }
    },

    finalize() {
      return {
        version: SEARCH_INDEX_VERSION,
        docs,
        docLengths,
        postings: Object.fromEntries(postings),
        degraded,
      };
    },
  };
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

export function extractSnippets(
  text: string,
  needles: readonly string[],
  contextLines: number,
  maxSnippets: number,
): string[] {
  const lines = text.split("\n");
  const lowered = lines.map((line) => line.toLowerCase());
  const snippets: string[] = [];
  const used = new Set<number>();
  for (const [lineIndex, line] of lowered.entries()) {
    if (snippets.length >= maxSnippets) break;
    if (used.has(lineIndex)) continue;
    if (!needles.some((needle) => line.includes(needle))) continue;
    const from = Math.max(0, lineIndex - contextLines);
    const to = Math.min(lines.length - 1, lineIndex + contextLines);
    for (let i = from; i <= to; i += 1) used.add(i);
    snippets.push(lines.slice(from, to + 1).join("\n"));
  }
  return snippets;
}

type GlobToken =
  | { readonly kind: "lit"; readonly ch: string }
  | { readonly kind: "one" }
  | { readonly kind: "seg" }
  | { readonly kind: "anyseg" }
  | { readonly kind: "any" };

export function globToMatcher(glob: string): (path: string) => boolean {
  const toks: GlobToken[] = [];
  let i = 0;
  while (i < glob.length) {
    const char = glob[i]!;
    if (char === "*") {
      if (glob[i + 1] === "*") {
        while (glob[i] === "*") i += 1;
        if (glob[i] === "/") {
          i += 1;
          toks.push({ kind: "anyseg" });
        } else {
          toks.push({ kind: "any" });
        }
      } else {
        i += 1;
        toks.push({ kind: "seg" });
      }
    } else if (char === "?") {
      i += 1;
      toks.push({ kind: "one" });
    } else {
      i += 1;
      toks.push({ kind: "lit", ch: char });
    }
  }
  const n = toks.length;
  return (path: string): boolean => {
    const m = path.length;
    const memo = new Map<number, boolean>();
    const solve = (ti: number, pj: number): boolean => {
      if (ti === n) return pj === m;
      const key = ti * (m + 1) + pj;
      const cached = memo.get(key);
      if (cached !== undefined) return cached;
      const tok = toks[ti]!;
      let res: boolean;
      if (tok.kind === "lit") {
        res = pj < m && path[pj] === tok.ch && solve(ti + 1, pj + 1);
      } else if (tok.kind === "one") {
        res = pj < m && path[pj] !== "/" && solve(ti + 1, pj + 1);
      } else if (tok.kind === "seg") {
        res =
          solve(ti + 1, pj) ||
          (pj < m && path[pj] !== "/" && solve(ti, pj + 1));
      } else if (tok.kind === "anyseg") {
        const atBoundary = pj === 0 || path[pj - 1] === "/";
        res =
          (atBoundary && solve(ti + 1, pj)) || (pj < m && solve(ti, pj + 1));
      } else {
        res = solve(ti + 1, pj) || (pj < m && solve(ti, pj + 1));
      }
      memo.set(key, res);
      return res;
    };
    return solve(0, 0);
  };
}
