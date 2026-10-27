import { ARTIFACT_INTERNAL_LINK_PREFIX } from "api-server-api";

const INTERNAL_LINK = new RegExp(
  `${ARTIFACT_INTERNAL_LINK_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([A-Za-z0-9-]+)`,
  "g",
);

interface LinkedArtifact {
  title: string;
  shareUrl: string | null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: An artifact's `platform://artifacts/<id>` link opens only in the app's chat; Slack and Telegram show it as dead text. Before a channel message is posted, each such link becomes the artifact's share URL. An artifact with no share URL (a private one) or one the owner does not have refuses the message, and the error tells the agent to say the artifact must be shared first and to send the message without the link.
 */
export async function withChannelArtifactLinks(
  text: string,
  surface: string,
  lookup: (id: string) => Promise<LinkedArtifact | null>,
): Promise<{ text: string } | { error: string }> {
  const ids = [...new Set([...text.matchAll(INTERNAL_LINK)].map((m) => m[1]!))];
  if (ids.length === 0) return { text };
  const shareUrls = new Map<string, string>();
  for (const id of ids) {
    const artifact = await lookup(id);
    if (!artifact)
      return {
        error: `The message links ${ARTIFACT_INTERNAL_LINK_PREFIX}${id}, but no artifact of your owner has that id. Send the message without that link.`,
      };
    if (artifact.shareUrl === null)
      return {
        error: `The message links the artifact "${artifact.title}" (${ARTIFACT_INTERNAL_LINK_PREFIX}${id}). That link opens only in the app's chat, and the artifact is private, so it has no link that opens in ${surface}. Nothing was posted. Say that the artifact must be shared from the app before people here can open it, and send the message without the link.`,
      };
    shareUrls.set(id, artifact.shareUrl);
  }
  return {
    text: text.replace(INTERNAL_LINK, (_, id: string) => shareUrls.get(id)!),
  };
}
