import { createHash } from "node:crypto";
import { Resvg } from "@resvg/resvg-js";
import { type Avatar, avatarSvg } from "api-server-api/avatar/svg";
import { type Db, eq, slackIconUrls } from "db";
import { match } from "ts-pattern";
import { formatError } from "../../../core/format-error.js";
import { getLogger } from "../../../core/logger.js";

const ICON_PX = 512;
const UPLOAD_TIMEOUT_MS = 10_000;
const RETRY_AFTER_MS = 60_000;
const IMGBB_UPLOAD_URL = "https://api.imgbb.com/1/upload";
const TWEMOJI_BASE =
  "https://cdn.jsdelivr.net/gh/jdecked/twemoji@17.0.3/assets/72x72";

export type AgentIconUrl = (avatar: Avatar) => Promise<string | null>;

export interface AgentIconStore {
  url: (hash: string) => Promise<string | null>;
  saveUrl: (hash: string, url: string) => Promise<void>;
  image: (id: string) => Promise<Buffer | null>;
}

export function createDbAgentIconStore(
  db: Db,
  image: AgentIconStore["image"],
): AgentIconStore {
  return {
    async url(hash) {
      const [row] = await db
        .select({ url: slackIconUrls.url })
        .from(slackIconUrls)
        .where(eq(slackIconUrls.hash, hash))
        .limit(1);
      return row?.url ?? null;
    },
    async saveUrl(hash, url) {
      await db
        .insert(slackIconUrls)
        .values({ hash, url })
        .onConflictDoUpdate({ target: slackIconUrls.hash, set: { url } });
    },
    image,
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Twemoji names a file by the emoji's code points,
 * and drops U+FE0F unless the emoji is a ZWJ sequence. An emoji newer than the
 * pinned Twemoji release has no file, and Slack then shows the app's icon.
 */
export function twemojiUrl(emoji: string): string {
  const chars = emoji.includes("\u200d") ? emoji : emoji.replace(/\ufe0f/g, "");
  const name = [...chars].map((c) => c.codePointAt(0)!.toString(16)).join("-");
  return `${TWEMOJI_BASE}/${name}.png`;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Slack shows a message's icon_url by fetching it
 * from the public internet, and it takes no inline image data. An internal
 * install has no public URL of its own, so a character avatar is drawn to a PNG
 * and an uploaded image is read from Postgres, and the PNG is uploaded to
 * ImgBB, a public image host. The URL is stored in Postgres under the hash of
 * the PNG, so a restart or another replica reuses it and each image is uploaded
 * once per install. A post waits for the upload, bounded by UPLOAD_TIMEOUT_MS;
 * a failed upload is tried again after RETRY_AFTER_MS, so a broken image host
 * delays one post per avatar a minute, not every post. An emoji avatar needs no
 * upload: it links the public Twemoji PNG.
 */
export function createImgbbAgentIcons(
  apiKey: string,
  store: AgentIconStore,
  fetchImpl: typeof fetch = fetch,
): AgentIconUrl {
  const urls = new Map<string, Promise<string | null>>();
  const failedAt = new Map<string, number>();

  const upload = async (png: Uint8Array, hash: string): Promise<string> => {
    const stored = await store.url(hash);
    if (stored) return stored;
    const form = new FormData();
    form.set("key", apiKey);
    form.set(
      "image",
      new Blob([new Uint8Array(png)], { type: "image/png" }),
      `${hash.slice(0, 16)}.png`,
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
    await store.saveUrl(hash, url);
    return url;
  };

  const iconFor = async (
    key: string,
    png: () => Promise<Uint8Array | null>,
  ) => {
    const failed = failedAt.get(key);
    if (failed !== undefined && Date.now() - failed < RETRY_AFTER_MS)
      return null;
    let url = urls.get(key);
    if (!url) {
      url = png()
        .then((bytes) =>
          bytes
            ? upload(bytes, createHash("sha256").update(bytes).digest("hex"))
            : null,
        )
        .catch((err: unknown) => {
          urls.delete(key);
          failedAt.set(key, Date.now());
          getLogger().warn(
            { key, error: formatError(err) },
            "slack.agent_icon.upload_failed",
          );
          return null;
        });
      urls.set(key, url);
    }
    return url;
  };

  return (avatar) =>
    match(avatar)
      .with({ kind: "character" }, ({ character }) =>
        iconFor(`character:${character}`, async () =>
          new Resvg(avatarSvg(character), {
            fitTo: { mode: "width", value: ICON_PX },
          })
            .render()
            .asPng(),
        ),
      )
      .with({ kind: "image" }, ({ id }) =>
        iconFor(`image:${id}`, () => store.image(id)),
      )
      .with({ kind: "emoji" }, ({ emoji }) =>
        Promise.resolve(twemojiUrl(emoji)),
      )
      .exhaustive();
}
