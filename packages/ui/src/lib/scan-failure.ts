import { type ScanFailure, scanFailureSchema } from "api-server-api";

const CONNECTION_VERDICTS: ReadonlySet<ScanFailure["code"]> = new Set([
  "needs_github_connection",
  "repo_unreachable",
]);

export function isConnectionFailure(failure: ScanFailure): boolean {
  return CONNECTION_VERDICTS.has(failure.code);
}

const UNCLASSIFIED: ScanFailure = {
  code: "other",
  title: "Can't load skills from this source",
  detail:
    "Something went wrong reading this repository. Try re-scanning in a moment.",
};

export function toScanFailure(err: unknown): ScanFailure {
  const data = (err as { data?: unknown })?.data;
  if (!data || typeof data !== "object" || !("scanFailure" in data)) {
    return UNCLASSIFIED;
  }
  const parsed = scanFailureSchema.safeParse(data.scanFailure);
  return parsed.success ? parsed.data : UNCLASSIFIED;
}
