import { getAccessToken } from "../../../auth.js";

function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const match = /filename="?([^"]+)"?/.exec(header);
  return match?.[1] ?? null;
}

function isDirectDownload(body: unknown): body is { url: string } {
  return (
    typeof body === "object" &&
    body !== null &&
    "url" in body &&
    typeof (body as { url: unknown }).url === "string"
  );
}

function saveAs(href: string, filename?: string): void {
  const anchor = document.createElement("a");
  anchor.href = href;
  if (filename) anchor.download = filename;
  anchor.click();
}

/** Download a Run's Candidate. The route is authenticated (no plain anchor).
 *  It answers either JSON `{ url }` — a direct store link we navigate to,
 *  since fetching it cross-origin would hit CORS — or the relayed blob. */
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

  if (response.headers.get("Content-Type")?.includes("application/json")) {
    const body: unknown = await response.json();
    if (!isDirectDownload(body)) {
      throw new Error("Download failed (malformed direct-download response)");
    }
    saveAs(body.url);
    return;
  }

  const blob = await response.blob();
  const filename =
    filenameFromDisposition(response.headers.get("Content-Disposition")) ??
    "candidate.zip";
  const url = URL.createObjectURL(blob);
  saveAs(url, filename);
  // Deferred: revoking in the click's tick can cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
