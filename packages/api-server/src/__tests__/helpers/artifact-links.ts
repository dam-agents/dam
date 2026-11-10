import { withChannelArtifactLinks } from "../../modules/artifact-library/channel-links.js";
import type { LinkOutboundArtifacts } from "../../modules/channels/infrastructure/outbound-artifact-links.js";

export interface StubArtifact {
  id: string;
  title: string;
  shareUrl: string | null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: A worker test asks the real artifact-link rule, over a fixed library, what its resolved destination allows, so a send is judged by the code under test and never by a mocked verdict beside it.
 */
export function artifactLinks(
  artifacts: StubArtifact[] = [],
  appBaseUrl = "http://ui",
): LinkOutboundArtifacts {
  return ({ surface, ownerDirectMessage, text }) =>
    withChannelArtifactLinks(text, {
      surface,
      appArtifactUrl: (id) => `${appBaseUrl}/artifacts/${id}`,
      lookup: async (id) => artifacts.find((a) => a.id === id) ?? null,
      ownerDirectMessage: async () => ownerDirectMessage,
    });
}

export const noArtifacts = artifactLinks();
