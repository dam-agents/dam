import type {
  CaseStudyContentSource,
  CaseStudyEdition,
  CaseStudyEditionSummary,
  CaseStudyStatus,
} from "api-server-api";

export interface EditionRecord {
  id: string;
  agentId: string;
  editionWeekStart: string;
  windowStart: string;
  windowEnd: string;
  content: string;
  harnessImage: string | null;
  artifactId: string | null;
  status: CaseStudyStatus;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export const DAY_MS = 86_400_000;

export function editionWeekStartOf(now: Date): string {
  const midnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const isoWeekday = new Date(midnight).getUTCDay() || 7;
  const monday = new Date(midnight - (isoWeekday - 1) * DAY_MS);
  return monday.toISOString().slice(0, 10);
}

export type ReleaseVerdict = "release" | "already-released" | "not-releasable";

export function releaseVerdict(status: CaseStudyStatus): ReleaseVerdict {
  if (status === "pending") return "release";
  if (status === "released") return "already-released";
  return "not-releasable";
}

export interface ResolvedContent {
  content: string;
  source: CaseStudyContentSource;
}

function carried(
  record: EditionRecord,
  resolved?: ResolvedContent,
): ResolvedContent {
  return resolved ?? { content: record.content, source: "submitted" };
}

export function toSummary(
  record: EditionRecord,
  resolved?: ResolvedContent,
): CaseStudyEditionSummary {
  const { content, source } = carried(record, resolved);
  return {
    id: record.id,
    agentId: record.agentId,
    editionWeekStart: record.editionWeekStart,
    windowStart: record.windowStart,
    windowEnd: record.windowEnd,
    status: record.status,
    harnessImage: record.harnessImage,
    artifactId: record.artifactId,
    contentChars: content.length,
    contentSource: source,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function toEdition(
  record: EditionRecord,
  resolved?: ResolvedContent,
): CaseStudyEdition {
  return {
    ...toSummary(record, resolved),
    content: carried(record, resolved).content,
  };
}
