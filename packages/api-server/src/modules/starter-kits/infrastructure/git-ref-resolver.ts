import { readBytesWithin } from "./bounded-read.js";
import type { GitHosts } from "./git-hosts.js";

const MAX_ADVERTISEMENT_BYTES = 2 * 1024 * 1024;
const SHA = /^[0-9a-f]{40}$/;

export type RefResolution =
  | { status: "resolved"; sha: string }
  | { status: "absent" }
  | { status: "unreachable" };

export interface RefResolver {
  resolve(gitUrl: string, ref?: string): Promise<RefResolution>;
}

export function parseRefAdvertisement(body: Buffer): {
  head: string | null;
  refs: Map<string, string>;
} {
  const refs = new Map<string, string>();
  let head: string | null = null;
  let symrefTarget: string | null = null;

  let i = 0;
  while (i + 4 <= body.length) {
    const len = Number.parseInt(body.toString("ascii", i, i + 4), 16);
    if (Number.isNaN(len)) break;
    if (len === 0) {
      i += 4;
      continue;
    }
    if (len < 4) break;
    const payload = body
      .toString("utf8", i + 4, Math.min(i + len, body.length))
      .trim();
    i += len;

    const sha = payload.slice(0, 40);
    if (!SHA.test(sha)) continue;
    const name = payload.slice(41).split("\0")[0]!.split(" ")[0]!;
    if (name.length === 0) continue;
    if (name === "HEAD") {
      head = sha;
      const symref = /symref=HEAD:([^\s\0]+)/.exec(payload);
      if (symref) symrefTarget = symref[1]!;
      continue;
    }
    if (name.endsWith("^{}")) refs.set(name.slice(0, -3), sha);
    else if (!refs.has(name)) refs.set(name, sha);
  }
  if (head === null && symrefTarget) head = refs.get(symrefTarget) ?? null;
  return { head, refs };
}

function lookup(
  parsed: { head: string | null; refs: Map<string, string> },
  ref: string | undefined,
): string | null {
  if (ref === undefined || ref === "HEAD") return parsed.head;
  if (SHA.test(ref)) return ref;
  return (
    parsed.refs.get(`refs/heads/${ref}`) ??
    parsed.refs.get(`refs/tags/${ref}`) ??
    parsed.refs.get(ref) ??
    null
  );
}

export function createGitRefResolver(
  hosts: GitHosts,
  fetchImpl: typeof fetch = fetch,
): RefResolver {
  return {
    async resolve(gitUrl, ref) {
      const repo = hosts.locate(gitUrl);
      if (!repo) return { status: "absent" };
      const request = repo.refAdvertisement();
      const res = await fetchImpl(request.url, { headers: request.headers });
      if (!res.ok) return { status: "unreachable" };
      const body = await readBytesWithin(res, MAX_ADVERTISEMENT_BYTES);
      if (body === null) return { status: "unreachable" };
      const sha = lookup(parseRefAdvertisement(body), ref);
      return sha === null ? { status: "absent" } : { status: "resolved", sha };
    },
  };
}
