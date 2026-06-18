import { fetchFileContent, type FileContent } from "../api/queries.js";

export function base64ToBlob(base64: string, mimeType: string): Blob {
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

export function downloadFileContent(file: FileContent): void {
  if (!file.content) return;
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
