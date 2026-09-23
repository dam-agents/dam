import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { Resvg } from "@resvg/resvg-js";
import { avatarSvg } from "api-server-api/avatar/svg";
import { avatarKey } from "api-server-api/avatar/traits";
import { formatError } from "../../../core/format-error.js";
import { getLogger } from "../../../core/logger.js";

const ICON_PX = 128;
const UPLOAD_TIMEOUT_MS = 10_000;
const ICON_WAIT_MS = 2_000;
const RETRY_AFTER_MS = 10 * 60_000;
const IMGBB_UPLOAD_URL = "https://api.imgbb.com/1/upload";

export type AgentIconUrl = (
  ownerSub: string,
  name: string,
) => Promise<string | null>;

/**
 * UNIT_BOUNDARY_DESCRIPTION: Slack shows a message's icon_url by fetching it
 * from the public internet, and it takes no inline image data. An internal
 * install has no public URL of its own, so the agent's avatar is drawn to a PNG
 * here and uploaded once to ImgBB, a public image host. The PNG is named by a
 * hash, never by the agent name, and each (owner, name) is uploaded once per
 * process. A Slack post waits at most ICON_WAIT_MS for the upload: past that it
 * goes out with the bot's own icon while the upload finishes for later posts. A
 * failed upload is not tried again for RETRY_AFTER_MS, so a slow or broken
 * image host delays one post per avatar, not every post.
 */
export function createImgbbAgentIcons(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  waitMs = ICON_WAIT_MS,
): AgentIconUrl {
  const urls = new Map<string, Promise<string | null>>();
  const failedAt = new Map<string, number>();

  const upload = async (key: string): Promise<string> => {
    const png = new Resvg(avatarSvg(key), {
      fitTo: { mode: "width", value: ICON_PX },
    })
      .render()
      .asPng();
    const form = new FormData();
    form.set("key", apiKey);
    form.set(
      "image",
      new Blob([new Uint8Array(png)], { type: "image/png" }),
      `${createHash("sha256").update(key).digest("hex").slice(0, 16)}.png`,
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

  return (ownerSub, name) => {
    const key = avatarKey(ownerSub, name);
    const failed = failedAt.get(key);
    if (failed !== undefined && Date.now() - failed < RETRY_AFTER_MS)
      return Promise.resolve(null);
    let url = urls.get(key);
    if (!url) {
      url = upload(key).catch((err: unknown) => {
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
    return Promise.race([url, sleep(waitMs, null, { ref: false })]);
  };
}
