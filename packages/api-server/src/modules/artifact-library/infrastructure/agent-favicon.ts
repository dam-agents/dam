import { avatarSvg, emojiSvg, parseAvatar } from "api-server-api/avatar/svg";
import sharp from "sharp";
import { match } from "ts-pattern";
import { formatError } from "../../../core/format-error.js";
import { getLogger } from "../../../core/logger.js";

const FAVICON_PX = 64;
const IMAGE_CACHE_MAX = 256;

export type AgentFavicon = (
  agentId: string,
  owner: string,
) => Promise<string | null>;

export interface FaviconAgent {
  name: string;
  owner?: string;
  spec: { avatar?: string };
}

const svgDataUri = (svg: string) =>
  `data:image/svg+xml,${encodeURIComponent(svg)}`;

export function createAgentFavicon(deps: {
  getAgent: (id: string, owner: string) => Promise<FaviconAgent | null>;
  loadImage: (id: string) => Promise<Uint8Array | null>;
}): AgentFavicon {
  const images = new Map<string, string>();

  const imageDataUri = async (id: string): Promise<string | null> => {
    const cached = images.get(id);
    if (cached) return cached;
    const png = await deps.loadImage(id);
    if (!png) return null;
    const small = await sharp(png)
      .resize(FAVICON_PX, FAVICON_PX, { fit: "cover" })
      .png()
      .toBuffer();
    const uri = `data:image/png;base64,${small.toString("base64")}`;
    if (images.size >= IMAGE_CACHE_MAX) {
      images.delete(images.keys().next().value!);
    }
    images.set(id, uri);
    return uri;
  };

  return async (agentId, owner) => {
    try {
      const agent = await deps.getAgent(agentId, owner);
      if (!agent) return null;
      return await match(
        parseAvatar(agent.spec.avatar, agent.owner ?? owner, agent.name),
      )
        .with({ kind: "character" }, ({ character }) =>
          svgDataUri(avatarSvg(character)),
        )
        .with({ kind: "emoji" }, ({ emoji }) => svgDataUri(emojiSvg(emoji)))
        .with({ kind: "image" }, ({ id }) => imageDataUri(id))
        .exhaustive();
    } catch (err) {
      getLogger().warn(
        { agentId, err: formatError(err) },
        "share.agent_favicon_failed: falling back to the brand icon",
      );
      return null;
    }
  };
}
