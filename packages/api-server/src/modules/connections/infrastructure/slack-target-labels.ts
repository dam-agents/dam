import { z } from "zod";
import type { SlackMessageTarget } from "../domain/slack-message-target.js";
import { getJson } from "./account-lookups.js";
import { displayLabel } from "./github-identity.js";

const SLACK_API = "https://slack.com/api";

const conversationInfoSchema = z.object({
  ok: z.boolean(),
  channel: z
    .object({
      name: z.string().optional(),
      is_im: z.boolean().optional(),
      is_mpim: z.boolean().optional(),
      user: z.string().optional(),
    })
    .optional(),
});

const userInfoSchema = z.object({
  ok: z.boolean(),
  user: z
    .object({
      name: z.string().optional(),
      real_name: z.string().optional(),
      profile: z
        .object({
          display_name: z.string().optional(),
          real_name: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

async function personName(
  accessToken: string,
  userId: string,
  signal: AbortSignal,
): Promise<string | null> {
  const info = userInfoSchema.parse(
    await getJson(
      `${SLACK_API}/users.info?user=${encodeURIComponent(userId)}`,
      accessToken,
      "GET",
      signal,
    ),
  );
  if (!info.ok) return null;
  return (
    info.user?.profile?.display_name ||
    info.user?.profile?.real_name ||
    info.user?.real_name ||
    info.user?.name ||
    null
  );
}

async function conversationName(
  accessToken: string,
  conversationId: string,
  signal: AbortSignal,
): Promise<string | null> {
  const info = conversationInfoSchema.parse(
    await getJson(
      `${SLACK_API}/conversations.info?channel=${encodeURIComponent(conversationId)}`,
      accessToken,
      "GET",
      signal,
    ),
  );
  const channel = info.ok ? info.channel : undefined;
  if (!channel || channel.is_mpim) return null;
  if (channel.is_im)
    return channel.user ? personName(accessToken, channel.user, signal) : null;
  return channel.name ? `#${channel.name}` : null;
}

// UNIT_BOUNDARY_DESCRIPTION: the name Slack gives the target of a message, asked of the Slack Web API on slack.com with the person's own token: `#name` for a channel, and the person's display name, else their real name, for a direct message or a person. A group direct message has no name a person would know, so it gets none, and so does an answer that is not ok. The name comes from Slack, so it is stripped of control bytes and capped.
export async function lookupSlackTargetLabel(
  accessToken: string,
  target: SlackMessageTarget,
  signal: AbortSignal,
): Promise<string | null> {
  const name =
    target.kind === "person"
      ? await personName(accessToken, target.id, signal)
      : await conversationName(accessToken, target.id, signal);
  return name ? displayLabel(name) : null;
}
