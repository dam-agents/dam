import { readFileSync } from "node:fs";

/**
 * Reads the helm-mounted trusted-hosts file and returns the parsed list.
 * Returns an empty list when the path is unset or the file is missing —
 * the `trusted` preset stays selectable, it just seeds nothing. Lines are
 * trimmed; blank lines and `#`-comments are ignored.
 */
export function loadTrustedHosts(path: string): readonly string[] {
  if (!path) return [];
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    process.stderr.write(`trusted-hosts: ${path}: ${err instanceof Error ? err.message : err}\n`);
    return [];
  }
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}
