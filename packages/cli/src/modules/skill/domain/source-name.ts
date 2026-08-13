export function deriveSourceName(gitUrl: string): string {
  let pathname: string;
  try {
    pathname = new URL(gitUrl).pathname;
  } catch {
    return "";
  }
  return pathname
    .replace(/^\//, "")
    .replace(/\/$/, "")
    .replace(/\.git$/, "");
}
