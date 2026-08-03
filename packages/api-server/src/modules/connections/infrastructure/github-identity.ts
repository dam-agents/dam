import { z } from "zod";

const USER_LOOKUP_TIMEOUT_MS = 10_000;

export interface GitHubIdentity {
  name: string;
  email: string;
}

const userSchema = z.object({
  login: z.string(),
  id: z.number(),
  name: z.string().nullable(),
  email: z.string().nullable(),
});

// Drop control chars (incl. CR/LF) so a display name can't inject extra
// ~/.gitconfig sections when serialized into the [user] block.
function sanitizeName(name: string): string {
  return [...name]
    .filter((c) => {
      const code = c.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join("");
}

export async function resolveGitHubIdentity(
  accessToken: string,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<GitHubIdentity> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl("https://api.github.com/user", {
    signal: AbortSignal.timeout(USER_LOOKUP_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "platform",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub GET /user failed: ${res.status} ${res.statusText}`);
  }
  const user = userSchema.parse(await res.json());
  // No-reply fallback keeps a private primary email out of commit history.
  return {
    name: sanitizeName(user.name ?? user.login),
    email: user.email ?? `${user.id}+${user.login}@users.noreply.github.com`,
  };
}
