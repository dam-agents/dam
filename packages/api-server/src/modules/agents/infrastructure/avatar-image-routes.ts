import { createHash } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { AVATAR_IMAGE_RE } from "api-server-api/avatar/svg";
import sharp from "sharp";
import {
  and,
  avatarImages,
  type Db,
  eq,
  inArray,
  lt,
  notInArray,
  publicImageUrls,
} from "db";
import type { ApiVariables } from "../../../core/http-context.js";

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const AVATAR_PX = 512;

export interface AvatarImages {
  save: (id: string, png: Buffer, ownerSub: string) => Promise<void>;
  load: (id: string) => Promise<Buffer | null>;
  sweep: (keep: readonly string[], createdBefore: Date) => Promise<number>;
}

export function createAvatarImagesRepository(db: Db): AvatarImages {
  return {
    async save(id, png, ownerSub) {
      await db
        .insert(avatarImages)
        .values({ id, png, ownerSub })
        .onConflictDoNothing();
    },
    async load(id) {
      const [row] = await db
        .select({ png: avatarImages.png })
        .from(avatarImages)
        .where(eq(avatarImages.id, id))
        .limit(1);
      return row?.png ?? null;
    },
    async sweep(keep, createdBefore) {
      return db.transaction(async (tx) => {
        const removed = await tx
          .delete(avatarImages)
          .where(
            and(
              lt(avatarImages.createdAt, createdBefore),
              keep.length > 0
                ? notInArray(avatarImages.id, [...keep])
                : undefined,
            ),
          )
          .returning({ id: avatarImages.id });
        const ids = removed.map((r) => r.id);
        if (ids.length > 0)
          await tx
            .delete(publicImageUrls)
            .where(inArray(publicImageUrls.sha256, ids));
        return ids.length;
      });
    },
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: An uploaded image no Agent spec names is removed,
 * with its Slack icon URL, which is stored under the same hash. Only images
 * older than a day go: an upload is saved before the spec that names it, so a
 * younger image may still be on its way onto a spec.
 */
export async function sweepAvatarImages(
  images: AvatarImages,
  specAvatars: readonly (string | undefined)[],
  now = Date.now(),
): Promise<number> {
  const keep = specAvatars.flatMap((a) => {
    const id = a?.match(AVATAR_IMAGE_RE)?.[1];
    return id ? [id] : [];
  });
  return images.sweep(keep, new Date(now - 24 * 60 * 60_000));
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Turns untrusted image bytes into a stored avatar:
 * only a JPG or PNG within the decode limit is accepted, cropped to a 512 px
 * square PNG and saved under its SHA-256. The caller bounds the byte size
 * before it reads the bytes.
 */
export async function storeAvatarImage(
  images: AvatarImages,
  input: Buffer,
  ownerSub: string,
): Promise<{ avatar: `image:${string}` } | { error: string }> {
  const format = await sharp(input)
    .metadata()
    .then((m) => m.format)
    .catch(() => undefined);
  if (format !== "jpeg" && format !== "png")
    return { error: "image must be a JPG or PNG" };
  const png = await sharp(input, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize(AVATAR_PX, AVATAR_PX, { fit: "cover" })
    .png()
    .toBuffer()
    .catch(() => null);
  if (!png) return { error: "image could not be read" };
  const id = createHash("sha256").update(png).digest("hex");
  await images.save(id, png, ownerSub);
  return { avatar: `image:${id}` };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: An uploaded agent avatar. `POST /api/avatars`
 * takes a JPG or PNG of at most 2 MB, crops it to a 512 px square PNG, and
 * stores it in Postgres under the SHA-256 of that PNG; the answer is the avatar
 * value to put on the Agent spec. `GET /api/public/avatars/:id` serves it with
 * no sign-in, because an `<img>` sends no bearer token. The id is the hash of
 * the image, so it cannot be guessed and the response never changes.
 */
export function createAvatarImageRoutes(images: AvatarImages) {
  const upload = new Hono<{ Variables: ApiVariables }>();
  upload.post(
    "/",
    bodyLimit({
      maxSize: MAX_AVATAR_BYTES,
      onError: (c) => c.json({ error: "image is larger than 2 MB" }, 413),
    }),
    async (c) => {
      if (!c.get("user").scopes.includes("agents:manage"))
        return c.json({ error: "forbidden" }, 403);
      const stored = await storeAvatarImage(
        images,
        Buffer.from(await c.req.arrayBuffer()),
        c.get("user").sub,
      );
      return "error" in stored ? c.json(stored, 400) : c.json(stored);
    },
  );

  const serve = new Hono();
  serve.get("/:id{[0-9a-f]{64}}", async (c) => {
    const png = await images.load(c.req.param("id"));
    if (!png) return c.json({ error: "not found" }, 404);
    c.header("Content-Type", "image/png");
    c.header("Cache-Control", "public, max-age=31536000, immutable");
    return c.body(new Uint8Array(png));
  });

  return { upload, serve };
}
