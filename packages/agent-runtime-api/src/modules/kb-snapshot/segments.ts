import { z } from "zod";

import { sha256Hex } from "./hash.js";
import { tokenize } from "./tokenize.js";

export const INDEX_FORMAT_VERSION = 3;
export const SEGMENT_BUDGET_BYTES = 8 * 1024 * 1024;

const SEGMENT_TARGET_TEXT_BYTES = 4 * 1024 * 1024;
const SEGMENT_MIN_AVG_TEXT_BYTES = 1024 * 1024;
const SEGMENT_MAX_AVG_TEXT_BYTES = 8 * 1024 * 1024;
const MAX_BUCKET_COUNT = 256;

export interface IndexSegment {
  version: number;
  docs: string[];
  docLengths: number[];
  postings: Record<string, number[]>;
  degraded: boolean;
}

const indexSegmentSchema = z.object({
  version: z.literal(INDEX_FORMAT_VERSION),
  docs: z.array(z.string()),
  docLengths: z.array(z.number()),
  postings: z.record(z.string(), z.array(z.number())),
  degraded: z.boolean(),
});

export function parseSegment(raw: string): IndexSegment | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = indexSegmentSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function bucketForPath(path: string, bucketCount: number): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < path.length; i += 1) {
    hash ^= path.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % bucketCount;
}

export function chooseBucketCount(
  totalTextBytes: number,
  previous?: number,
): number {
  if (previous !== undefined && previous >= 1) {
    const average = totalTextBytes / previous;
    if (
      average >= SEGMENT_MIN_AVG_TEXT_BYTES &&
      average <= SEGMENT_MAX_AVG_TEXT_BYTES
    ) {
      return previous;
    }
  }
  let count = 1;
  while (
    count < MAX_BUCKET_COUNT &&
    totalTextBytes / count > SEGMENT_TARGET_TEXT_BYTES
  ) {
    count *= 2;
  }
  return count;
}

export interface SegmentMember {
  path: string;
  contentHash: string;
}

export function segmentContentId(
  members: readonly SegmentMember[],
  bucketCount: number,
): string {
  const sorted = [...members].sort((a, b) => a.path.localeCompare(b.path));
  const body = sorted.map((m) => `${m.path}\n${m.contentHash}`).join("\n");
  return sha256Hex(`v${INDEX_FORMAT_VERSION}:${bucketCount}:${body}`);
}

export interface SegmentSourceFile {
  path: string;
  text: string;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: builds one index segment as a pure function of
 * the current files in its bucket — flat [docIndex, tf, ...] posting arrays
 * keep the in-memory shape close to the serialized one, and the byte budget
 * degrades the segment (docs listed, no postings) instead of growing without
 * bound, so a build's peak memory is one segment regardless of corpus size.
 */
export function buildSegment(
  files: readonly SegmentSourceFile[],
  budgetBytes: number = SEGMENT_BUDGET_BYTES,
): IndexSegment {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const docs: string[] = [];
  const docLengths: number[] = [];
  const postings = new Map<string, number[]>();
  let approximateBytes = 0;
  let degraded = false;
  for (const file of sorted) {
    const docIndex = docs.length;
    docs.push(file.path);
    approximateBytes += file.path.length + 8;
    if (degraded) {
      docLengths.push(0);
      continue;
    }
    const tokens = tokenize(file.text);
    docLengths.push(tokens.length);
    const frequencies = new Map<string, number>();
    for (const token of tokens) {
      frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    }
    for (const [token, tf] of frequencies) {
      const list = postings.get(token);
      if (list) {
        list.push(docIndex, tf);
        approximateBytes += 8;
      } else {
        postings.set(token, [docIndex, tf]);
        approximateBytes += token.length + 24;
      }
      if (approximateBytes > budgetBytes) {
        degraded = true;
        break;
      }
    }
  }
  if (degraded) {
    return {
      version: INDEX_FORMAT_VERSION,
      docs,
      docLengths: docs.map(() => 0),
      postings: {},
      degraded: true,
    };
  }
  return {
    version: INDEX_FORMAT_VERSION,
    docs,
    docLengths,
    postings: Object.fromEntries(postings),
    degraded: false,
  };
}
