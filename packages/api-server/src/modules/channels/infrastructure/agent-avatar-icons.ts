import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { Resvg } from "@resvg/resvg-js";
import {
  AVATAR_CHARACTERS,
  type AvatarCharacter,
  avatarSvg,
} from "api-server-api/avatar/svg";
import { formatError } from "../../../core/format-error.js";
import { getLogger } from "../../../core/logger.js";
import type { PublicImageUrls } from "./public-image-urls-repository.js";

const ICON_PX = 512;
const UPLOAD_TIMEOUT_MS = 10_000;
const ICON_WAIT_MS = 2_000;
const RETRY_AFTER_MS = 60_000;
const IMGBB_UPLOAD_URL = "https://api.imgbb.com/1/upload";

export type AgentIconUrl = (
  character: AvatarCharacter,
) => Promise<string | null>;

export interface AgentIcons {
  iconUrl: AgentIconUrl;
  warm(): Promise<void>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Slack shows a message's icon_url by fetching it
 * from the public internet, and it takes no inline image data. An internal
 * install has no public URL of its own, so the agent's avatar is drawn to a PNG
 * here and uploaded to ImgBB, a public image host. The URL is stored in
 * Postgres under the SHA-256 of the PNG bytes, so a restart or another replica
 * reuses it and each image is uploaded once per install, not once per process.
 * warm() resolves every character at startup, so a post rarely waits on the
 * image host. A Slack post waits at most ICON_WAIT_MS for the URL: past that it
 * goes out with the bot's own icon while the upload finishes for later posts. A
 * failed upload is not tried again for RETRY_AFTER_MS, so a broken image host
 * costs one attempt per avatar per minute, not one per post.
 */
export function createImgbbAgentIcons({
  apiKey,
  store,
  fetchImpl = fetch,
  waitMs = ICON_WAIT_MS,
}: {
  apiKey: string;
  store: PublicImageUrls;
  fetchImpl?: typeof fetch;
  waitMs?: number;
}): AgentIcons {
  const urls = new Map<AvatarCharacter, Promise<string | null>>();
  const failedAt = new Map<AvatarCharacter, number>();

  const upload = async (png: Uint8Array, sha256: string): Promise<string> => {
    const form = new FormData();
    form.set("key", apiKey);
    form.set(
      "image",
      new Blob([new Uint8Array(png)], { type: "image/png" }),
      `${sha256.slice(0, 16)}.png`,
    );
    const res = await fetchImpl(IMGBB_UPLOAD_URL, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => null)) as {
      data?: { url?: unknown };
    } | null;
    const url = body?.data?.url;
    if (!res.ok || typeof url !== "string" || !url.startsWith("https://"))
      throw new Error(`ImgBB upload answered HTTP ${res.status}`);
    return url;
  };

  const publicUrl = async (png: Uint8Array): Promise<string> => {
    const sha256 = createHash("sha256").update(png).digest("hex");
    const stored = await store.get(sha256).catch((err: unknown) => {
      getLogger().warn(
        { error: formatError(err) },
        "slack.agent_icon.lookup_failed",
      );
      return null;
    });
    if (stored) return stored;
    const url = await upload(png, sha256);
    await store.put(sha256, url).catch((err: unknown) => {
      getLogger().warn(
        { error: formatError(err) },
        "slack.agent_icon.store_failed",
      );
    });
    return url;
  };

  const characterUrl = async (key: AvatarCharacter): Promise<string> =>
    publicUrl(
      new Resvg(avatarSvg(key), { fitTo: { mode: "width", value: ICON_PX } })
        .render()
        .asPng(),
    );

  const resolve = (key: AvatarCharacter): Promise<string | null> => {
    const failed = failedAt.get(key);
    if (failed !== undefined && Date.now() - failed < RETRY_AFTER_MS)
      return Promise.resolve(null);
    let url = urls.get(key);
    if (!url) {
      url = characterUrl(key).catch((err: unknown) => {
        urls.delete(key);
        failedAt.set(key, Date.now());
        getLogger().warn(
          { error: formatError(err) },
          "slack.agent_icon.upload_failed",
        );
        return null;
      });
      urls.set(key, url);
    }
    return url;
  };

  return {
    iconUrl: (key) =>
      Promise.race([resolve(key), sleep(waitMs, null, { ref: false })]),
    async warm() {
      for (const key of AVATAR_CHARACTERS) await resolve(key);
    },
  };
}
