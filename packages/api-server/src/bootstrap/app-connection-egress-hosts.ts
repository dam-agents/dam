import { readFileSync } from "node:fs";

/**
 * Reads the helm-mounted JSON map of provider → API hosts and returns it
 * as an immutable Map. Used by the connections service to insert egress
 * rules when a user grants an app connection. Empty/missing file → empty
 * map; grants stay rule-less but the rest of the app works.
 *
 * The file shape is `{ "<provider>": ["host1", "host2"], ... }` where
 * `<provider>` matches the `provider` field on OneCLI's
 * `/api/connections` rows. See the matching Helm template
 * `templates/apiserver/app-connection-egress-hosts.yaml`.
 */
export function loadAppConnectionEgressHosts(path: string): ReadonlyMap<string, readonly string[]> {
  if (!path) return new Map();
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    process.stderr.write(
      `app-connection-egress-hosts: ${path}: ${err instanceof Error ? err.message : err}\n`,
    );
    return new Map();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(
      `app-connection-egress-hosts: invalid JSON at ${path}: ${err instanceof Error ? err.message : err}\n`,
    );
    return new Map();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    process.stderr.write(
      `app-connection-egress-hosts: ${path}: expected an object, got ${Array.isArray(parsed) ? "array" : typeof parsed}\n`,
    );
    return new Map();
  }
  const result = new Map<string, readonly string[]>();
  for (const [provider, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const hosts = value
      .filter((h): h is string => typeof h === "string")
      .map((h) => h.trim())
      .filter((h) => h.length > 0);
    if (hosts.length > 0) result.set(provider, Object.freeze(hosts));
  }
  return result;
}
