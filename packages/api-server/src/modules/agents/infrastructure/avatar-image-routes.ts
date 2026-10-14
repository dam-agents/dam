import { createHash } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import sharp from "sharp";
import { avatarImages, type Db, eq } from "db";
import type { ApiVariables } from "../../../core/http-context.js";

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const AVATAR_PX = 512;

export interface AvatarImages {
  save: (id: string, png: Buffer, ownerSub: string) => Promise<void>;
  load: (id: string) => Promise<Buffer | null>;
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
  };
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
      maxSize: MAX_UPLOAD_BYTES,
      onError: (c) => c.json({ error: "image is larger than 2 MB" }, 413),
    }),
    async (c) => {
      if (!c.get("user").scopes.includes("agents:manage"))
        return c.json({ error: "forbidden" }, 403);
      const input = Buffer.from(await c.req.arrayBuffer());
      const format = await sharp(input)
        .metadata()
        .then((m) => m.format)
        .catch(() => undefined);
      if (format !== "jpeg" && format !== "png")
        return c.json({ error: "image must be a JPG or PNG" }, 400);
      const png = await sharp(input, { limitInputPixels: 40_000_000 })
        .rotate()
        .resize(AVATAR_PX, AVATAR_PX, { fit: "cover" })
        .png()
        .toBuffer();
      const id = createHash("sha256").update(png).digest("hex");
      await images.save(id, png, c.get("user").sub);
      return c.json({ avatar: `image:${id}` });
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
