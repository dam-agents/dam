/** Human file size, base 1024: "512 B", "3 KB", "1.5 MB". KB is rounded to a
 *  whole number, MB to one decimal. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
