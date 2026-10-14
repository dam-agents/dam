// TEST_OVERVIEW: An owner uploads a JPG or PNG as an agent's avatar. The api-server crops it to a 512 px square PNG, stores it under the hash of that PNG, and answers the avatar value for the Agent spec. Anyone can read it back by that id, since an <img> sends no token. Other formats and files over 2 MB are refused.
import { Hono } from "hono";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { ApiVariables } from "../../core/http-context.js";
import {
  type AvatarImages,
  createAvatarImageRoutes,
} from "../../modules/agents/infrastructure/avatar-image-routes.js";

function world(scopes = ["agents:manage"]) {
  const saved = new Map<string, Buffer>();
  const images: AvatarImages = {
    save: async (id, png) => void saved.set(id, png),
    load: async (id) => saved.get(id) ?? null,
  };
  const routes = createAvatarImageRoutes(images);
  const app = new Hono<{ Variables: ApiVariables }>();
  app.use("*", async (c, next) => {
    c.set("user", { sub: "u1", scopes } as never);
    await next();
  });
  app.route("/api/public/avatars", routes.serve);
  app.route("/api/avatars", routes.upload);
  const upload = (body: Uint8Array<ArrayBuffer>) =>
    app.request("/api/avatars", { method: "POST", body });
  return { app, saved, upload };
}

const jpeg = async (width: number, height: number) =>
  new Uint8Array(
    await sharp({
      create: { width, height, channels: 3, background: "#e89da8" },
    })
      .jpeg()
      .toBuffer(),
  );

describe("avatar image routes", () => {
  // TEST_SCENARIO: a wide JPG comes back as a 512 px square PNG under its hash, and the public read serves exactly that PNG.
  it("stores an upload as a square PNG and serves it", async () => {
    const { app, upload } = world();
    const res = await upload(await jpeg(900, 300));
    expect(res.status).toBe(200);
    const { avatar } = (await res.json()) as { avatar: string };
    expect(avatar).toMatch(/^image:[0-9a-f]{64}$/);

    const read = await app.request(`/api/public/avatars/${avatar.slice(6)}`);
    expect(read.headers.get("content-type")).toBe("image/png");
    const meta = await sharp(Buffer.from(await read.arrayBuffer())).metadata();
    expect(meta).toMatchObject({ format: "png", width: 512, height: 512 });
  });

  // TEST_SCENARIO: a file that is not a JPG or PNG, or one over 2 MB, is refused and nothing is stored.
  it("refuses other formats and large files", async () => {
    const { saved, upload } = world();
    const gif = await sharp({
      create: { width: 4, height: 4, channels: 3, background: "#000" },
    })
      .gif()
      .toBuffer();
    expect((await upload(new Uint8Array(gif))).status).toBe(400);
    expect((await upload(new TextEncoder().encode("<svg/>"))).status).toBe(400);
    expect((await upload(new Uint8Array(2 * 1024 * 1024 + 1))).status).toBe(
      413,
    );
    expect(saved.size).toBe(0);
  });

  // TEST_SCENARIO: a token without agents:manage cannot store an image, and an unknown id reads as not found.
  it("needs agents:manage and answers 404 for unknown ids", async () => {
    const { app, upload } = world(["agents:read"]);
    expect((await upload(await jpeg(10, 10))).status).toBe(403);
    const read = await app.request(`/api/public/avatars/${"0".repeat(64)}`);
    expect(read.status).toBe(404);
  });
});
