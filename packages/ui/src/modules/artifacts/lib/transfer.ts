import { getAccessToken } from "../../../auth.js";
import { getErrorMessage } from "../../../lib/errors.js";
import { formatBytes } from "../../../lib/format-size.js";
import { emitToast } from "../../../lib/toast.js";

export function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const extended = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  if (extended) {
    try {
      return decodeURIComponent(extended);
    } catch {
      return extended;
    }
  }
  const match = /filename="([^"]*)"|filename=([^;\s]+)/i.exec(header);
  return match?.[1] ?? match?.[2] ?? null;
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

async function uploadLimit(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    maxBytes?: unknown;
  } | null;
  const maxBytes = body?.maxBytes;
  return typeof maxBytes === "number"
    ? ` — the limit is ${formatBytes(maxBytes)}`
    : "";
}

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
        ? `File is too large${await uploadLimit(response)}`
        : `Upload failed (${response.status})`;
    throw new Error(message);
  }
  const body: unknown = await response.json();
  if (!isUploadReceipt(body)) {
    throw new Error("Upload failed (malformed response)");
  }
  return body.uploadRef;
}

export async function downloadArtifact(
  id: string,
  version?: number,
): Promise<void> {
  try {
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
    setTimeout(() => URL.revokeObjectURL(url), 0);
  } catch (err) {
    emitToast({ kind: "error", message: getErrorMessage(err) });
  }
}
