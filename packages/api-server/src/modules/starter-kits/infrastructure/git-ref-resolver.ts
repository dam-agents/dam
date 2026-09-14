import { parseGithubRepoUrl } from "./catalog-source.js";

const MAX_ADVERTISEMENT_BYTES = 2 * 1024 * 1024;
const SHA = /^[0-9a-f]{40}$/;

export interface RefResolver {
  resolve(gitUrl: string, ref?: string): Promise<string | null>;
}

export function parseRefAdvertisement(body: string): {
  head: string | null;
  refs: Map<string, string>;
} {
  const refs = new Map<string, string>();
  let head: string | null = null;
  let symrefTarget: string | null = null;

  for (const line of body.split("\n")) {
    const payload = line.replace(/^[0-9a-f]{4}/, "").trim();
    if (payload.length === 0) continue;
    const [sha, rest] = [payload.slice(0, 40), payload.slice(41)];
    if (!SHA.test(sha) || rest.length === 0) continue;
    const name = rest.split("\0")[0]!.split(" ")[0]!;
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
  fetchImpl: typeof fetch = fetch,
): RefResolver {
  return {
    async resolve(gitUrl, ref) {
      const repo = parseGithubRepoUrl(gitUrl);
      if (!repo) return null;
      const url = `https://github.com/${repo.owner}/${repo.repo}/info/refs?service=git-upload-pack`;
      const res = await fetchImpl(url);
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength > MAX_ADVERTISEMENT_BYTES) return null;
      return lookup(parseRefAdvertisement(buf.toString("utf8")), ref);
    },
  };
}
