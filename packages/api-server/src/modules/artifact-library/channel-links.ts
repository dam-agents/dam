import { ARTIFACT_INTERNAL_LINK_PREFIX } from "api-server-api";

const INTERNAL_LINK = new RegExp(
  `${ARTIFACT_INTERNAL_LINK_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([A-Za-z0-9-]+)`,
  "g",
);

export function hasArtifactReference(text: string): boolean {
  return text.includes(ARTIFACT_INTERNAL_LINK_PREFIX);
}

interface LinkedArtifact {
  title: string;
  shareUrl: string | null;
}

export interface ChannelArtifactLinks {
  surface: string;
  appArtifactUrl(id: string): string;
  lookup(id: string): Promise<LinkedArtifact | null>;
  ownerDirectMessage(): Promise<boolean>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: An artifact's `platform://artifacts/<id>` link opens only in the app's chat; Slack and Telegram show it as dead text. Before a channel message is posted, each such link becomes the artifact's share URL. A private artifact has no share URL, so its link becomes `appArtifactUrl`, that artifact's own page in the app behind the owner's sign-in, and only when `ownerDirectMessage` answers that the message lands in the 1:1 Slack DM between the bot and the artifact's owner. Everywhere else, and for an artifact the agent did not publish, the message is refused. `ownerDirectMessage` is asked only for a private artifact's link, and it is asked here rather than by the caller so that no send path can skip the destination. The error tells the agent to say the artifact must be shared first and to send the message without the link.
 */
export async function withChannelArtifactLinks(
  text: string,
  links: ChannelArtifactLinks,
): Promise<{ text: string } | { error: string }> {
  if (!hasArtifactReference(text)) return { text };
  const ids = [...new Set([...text.matchAll(INTERNAL_LINK)].map((m) => m[1]!))];
  if (ids.length === 0) return { text };
  const urls = new Map<string, string>();
  for (const id of ids) {
    const artifact = await links.lookup(id);
    if (!artifact)
      return {
        error: `The message links ${ARTIFACT_INTERNAL_LINK_PREFIX}${id}, but you published no artifact with that id. Send the message without that link.`,
      };
    if (artifact.shareUrl !== null) {
      urls.set(id, artifact.shareUrl);
      continue;
    }
    if (!(await links.ownerDirectMessage()))
      return {
        error: `The message links the artifact "${artifact.title}" (${ARTIFACT_INTERNAL_LINK_PREFIX}${id}). That link opens only in the app's chat, and the artifact is private, so it has no link that opens in ${links.surface}. Nothing was posted. Only a 1:1 DM between you and its owner may carry that link, and this message goes somewhere else. Say that the artifact must be shared from the app before people here can open it, and send the message without the link.`,
      };
    urls.set(id, links.appArtifactUrl(id));
  }
  return {
    text: text.replace(INTERNAL_LINK, (_, id: string) => urls.get(id)!),
  };
}
