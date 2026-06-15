import { z } from "zod";

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

/**
 * Resolves the identity of the account a GitHub access token belongs to, for
 * authoring the agent's git commits. `email` is the account's *public profile*
 * email when the user has published one (`GET /user` only ever exposes that),
 * otherwise the `{id}+{login}` no-reply — so a private primary address is never
 * pulled into commit history.
 */
export async function resolveGitHubIdentity(
  accessToken: string,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<GitHubIdentity> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl("https://api.github.com/user", {
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
  return {
    name: user.name ?? user.login,
    email: user.email ?? `${user.id}+${user.login}@users.noreply.github.com`,
  };
}
