import { normalizeServerUrl } from "../../shared/server-url.js";

export type SavedServerMatch =
  | { kind: "found"; host: string }
  | { kind: "unknown" }
  | { kind: "ambiguous"; candidates: ReadonlyArray<string> };

function withoutScheme(host: string): string {
  return host.replace(/^https?:\/\//, "");
}

function hostnameOf(host: string): string | undefined {
  return URL.canParse(host) ? new URL(host).hostname : undefined;
}

export function matchSavedServer(
  input: string,
  saved: ReadonlyArray<string>,
): SavedServerMatch {
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    const wanted = normalizeServerUrl(trimmed);
    return saved.includes(wanted)
      ? { kind: "found", host: wanted }
      : { kind: "unknown" };
  }
  const wanted = normalizeServerUrl(`https://${trimmed}`);
  const bare = withoutScheme(wanted);
  const exact = saved.filter((host) => withoutScheme(host) === bare);
  const candidates =
    exact.length > 0
      ? exact
      : saved.filter((host) => hostnameOf(host) === hostnameOf(wanted));
  if (candidates.length === 0) return { kind: "unknown" };
  if (candidates.length > 1) return { kind: "ambiguous", candidates };
  return { kind: "found", host: candidates[0]! };
}
