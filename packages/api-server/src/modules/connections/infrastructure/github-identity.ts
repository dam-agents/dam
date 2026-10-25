import { z } from "zod";

const USER_LOOKUP_TIMEOUT_MS = 10_000;

export interface GitHubIdentity {
  login: string;
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
 * UNIT_BOUNDARY_DESCRIPTION: a host-supplied label as the platform stores and
 * prints it. Control characters are dropped, and the C1 block with the C0 ones:
 * U+009B is a one-byte CSI, so it opens an escape sequence without an ESC and
 * would clear a terminal or fake output in it.
 */
export function stripControlChars(name: string): string {
  return [...name]
    .filter((c) => {
      const code = c.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f && !(code >= 0x80 && code <= 0x9f);
    })
    .join("");
}

export async function resolveGitHubIdentity(
  accessToken: string,
): Promise<GitHubIdentity> {
  const res = await fetch("https://api.github.com/user", {
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
  return {
    login: stripControlChars(user.login),
    name: stripControlChars(user.name ?? user.login),
    email: user.email ?? `${user.id}+${user.login}@users.noreply.github.com`,
  };
}
