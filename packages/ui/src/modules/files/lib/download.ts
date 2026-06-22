import { fetchFileContent, type FileContent } from "../api/queries.js";

export function base64ToBlob(base64: string, mimeType: string): Blob {
  const raw = atob(base64);
  const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: mimeType });
}

export function downloadFileContent(file: FileContent): void {
  if (file.tooLarge) throw new Error("File is too large to download");
  const name = file.path.split("/").pop() ?? "download";
  const blob = file.binary
    ? base64ToBlob(file.content, file.mimeType ?? "application/octet-stream")
    : new Blob([file.content], { type: file.mimeType ?? "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function downloadFileAt(
  agentId: string,
  path: string,
): Promise<void> {
  downloadFileContent(await fetchFileContent(agentId, path));
}
