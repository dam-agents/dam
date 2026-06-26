import { getAccessToken } from "../../../auth.js";

function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const match = /filename="?([^"]+)"?/.exec(header);
  return match?.[1] ?? null;
}

/** Download a Run's Candidate archive. The api-server serves it from Postgres
 *  on an authenticated `/api/*` route, so this can't be a plain anchor href —
 *  it fetches with the bearer token, then hands the blob to the browser. */
export async function downloadCandidate(
  experimentId: string,
  runId: string,
): Promise<void> {
  const token = await getAccessToken();
  const response = await fetch(
    `/api/experiments/${encodeURIComponent(experimentId)}/runs/${encodeURIComponent(runId)}/candidate`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) {
    throw new Error(`Download failed (${response.status})`);
  }
  const blob = await response.blob();
  const filename =
    filenameFromDisposition(response.headers.get("Content-Disposition")) ??
    "candidate.zip";
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
