import { z } from "zod";
import { resolveGitHubIdentity, stripControlChars } from "./github-identity.js";

const LOOKUP_TIMEOUT_MS = 10_000;

export type AccountLookup = (accessToken: string) => Promise<string>;

const slackAuthTestSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  user: z.string().optional(),
  user_id: z.string().optional(),
  team: z.string().optional(),
});

const slackUserInfoSchema = z.object({
  ok: z.boolean(),
  user: z
    .object({
      real_name: z.string().optional(),
      profile: z
        .object({
          real_name: z.string().optional(),
          display_name: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

const googleUserInfoSchema = z.object({ email: z.string().min(1) });

async function getJson(
  url: string,
  accessToken: string,
  method: "GET" | "POST" = "GET",
): Promise<unknown> {
  const res = await fetch(url, {
    method,
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`${method} ${url} failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function slackPersonName(
  accessToken: string,
  userId: string,
): Promise<string | undefined> {
  const info = slackUserInfoSchema.parse(
    await getJson(
      `https://slack.com/api/users.info?user=${encodeURIComponent(userId)}`,
      accessToken,
    ),
  );
  if (!info.ok) return undefined;
  return (
    info.user?.profile?.real_name ||
    info.user?.real_name ||
    info.user?.profile?.display_name ||
    undefined
  );
}

export const lookupSlackAccount: AccountLookup = async (accessToken) => {
  const who = slackAuthTestSchema.parse(
    await getJson("https://slack.com/api/auth.test", accessToken, "POST"),
  );
  if (!who.ok || !who.user_id) {
    throw new Error(`Slack auth.test failed: ${who.error ?? "no user"}`);
  }
  const person =
    (await slackPersonName(accessToken, who.user_id)) ??
    who.user ??
    who.user_id;
  const label = who.team ? `${person} (${who.team})` : person;
  return stripControlChars(label);
};

export const lookupGitHubAccount: AccountLookup = async (accessToken) =>
  (await resolveGitHubIdentity(accessToken)).login;

export const lookupGoogleAccount: AccountLookup = async (accessToken) => {
  const info = googleUserInfoSchema.parse(
    await getJson(
      "https://openidconnect.googleapis.com/v1/userinfo",
      accessToken,
    ),
  );
  return stripControlChars(info.email);
};
