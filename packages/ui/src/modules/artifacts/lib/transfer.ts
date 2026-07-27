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

function isUploadReceipt(body: unknown): body is { uploadRef: string } {
  return (
    typeof body === "object" &&
    body !== null &&
    "uploadRef" in body &&
    typeof (body as { uploadRef: unknown }).uploadRef === "string"
  );
}

function saveAs(href: string, filename?: string): void {
  const anchor = document.createElement("a");
  anchor.href = href;
  if (filename) anchor.download = filename;
  anchor.click();
}

/** Push raw file bytes through the authenticated upload route (browser →
 *  api-server → object store; no store CORS involved) and return the
 *  `uploadRef` to pass to the create/update mutations. */
export async function uploadArtifactFile(file: File): Promise<string> {
  const token = await getAccessToken();
  const response = await fetch(
    `/api/artifact-library/upload?filename=${encodeURIComponent(file.name)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": file.type || "application/octet-stream",
      },
      body: file,
    },
  );
  if (!response.ok) {
    const message =
      response.status === 413
        ? "File is too large"
        : `Upload failed (${response.status})`;
    throw new Error(message);
  }
  const body: unknown = await response.json();
  if (!isUploadReceipt(body)) {
    throw new Error("Upload failed (malformed response)");
  }
  return body.uploadRef;
}

/** Download an artifact (optionally a past version) — JSON `{ url }` means a
 *  presigned direct link we navigate to; otherwise the relayed blob. */
export async function downloadArtifact(
  id: string,
  version?: number,
): Promise<void> {
  const token = await getAccessToken();
  const query = version !== undefined ? `?v=${version}` : "";
  const response = await fetch(
    `/api/artifact-library/${encodeURIComponent(id)}/download${query}`,
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
    "artifact";
  const url = URL.createObjectURL(blob);
  saveAs(url, filename);
  // Deferred: revoking in the click's tick can cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
