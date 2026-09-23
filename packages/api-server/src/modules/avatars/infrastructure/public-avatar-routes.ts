import { AVATAR_VERSION, avatarKey, avatarSeed, avatarSvg } from "agent-avatar";
import { Hono } from "hono";
import sharp from "sharp";

const SIZE = 256;
const VIEWBOX_SIZE = 100;
const CACHE_LIMIT = 512;
const MAX_SEED = 0xffffffff;
const ONE_YEAR = 31_536_000;
const ONE_DAY = 86_400;

/**
 * UNIT_BOUNDARY_DESCRIPTION: An agent's avatar as a PNG, for surfaces that
 * fetch an image by URL rather than draw it, such as a Slack message icon.
 * The path carries the hash of the agent's owner and name (`avatarSeed` of
 * `avatarKey`), never either of them, and the figure is a pure function of that number: the route reads no
 * agent data, so it confirms nothing about which agents exist. The version
 * segment keys the design for caches that never revalidate; any version
 * renders the current design, but only the current one is marked immutable.
 * Rasters are cached in a bounded map, since each costs a librsvg render.
 */
export function createPublicAvatarRoutes(): Hono {
  const routes = new Hono();
  const cache = new Map<number, Buffer>();

  const render = async (seed: number): Promise<Buffer> => {
    const hit = cache.get(seed);
    if (hit) return hit;
    const png = await sharp(Buffer.from(avatarSvg(seed)), {
      density: (72 * SIZE) / VIEWBOX_SIZE,
    })
      .resize(SIZE, SIZE)
      .png()
      .toBuffer();
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    cache.set(seed, png);
    return png;
  };

  routes.get(
    "/avatars/:version{v\\d{1,4}}/:file{\\d{1,10}\\.png}",
    async (c) => {
      const seed = Number(c.req.param("file").slice(0, -".png".length));
      if (seed > MAX_SEED) return c.json({ error: "unknown avatar" }, 404);
      const current = c.req.param("version") === `v${AVATAR_VERSION}`;
      const png = await render(seed);
      c.header("Content-Type", "image/png");
      c.header(
        "Cache-Control",
        current
          ? `public, max-age=${ONE_YEAR}, immutable`
          : `public, max-age=${ONE_DAY}`,
      );
      return c.body(new Uint8Array(png));
    },
  );

  return routes;
}

export function publicAvatarPath(seed: number): string {
  return `/api/public/avatars/v${AVATAR_VERSION}/${seed}.png`;
}

export function publicAvatarUrl(
  baseUrl: string,
): (owner: string, agentName: string) => string {
  const origin = baseUrl.replace(/\/+$/, "");
  return (owner, agentName) =>
    `${origin}${publicAvatarPath(avatarSeed(avatarKey(owner, agentName)))}`;
}
