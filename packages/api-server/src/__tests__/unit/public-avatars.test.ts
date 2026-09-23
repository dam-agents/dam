// TEST_OVERVIEW: Slack draws a message icon from a URL, so the api-server serves each agent's avatar as a PNG under the unauthenticated /api/public prefix. The path names the hash of the agent's name, and the image must match the figure the UI draws.
import { AVATAR_VERSION, avatarSeed } from "agent-avatar";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  createPublicAvatarRoutes,
  publicAvatarPath,
} from "../../modules/avatars/infrastructure/public-avatar-routes.js";

const routes = createPublicAvatarRoutes();
const get = (path: string) =>
  routes.request(path.replace(/^\/api\/public/, ""));

describe("public avatar route", () => {
  // TEST_SCENARIO: Slack fetches the icon for an agent's message. It gets a square PNG it can cache for good, since the URL names the design version.
  it("serves a cacheable square PNG for an agent's name hash", async () => {
    const res = await get(publicAvatarPath(avatarSeed("velvet-comet")));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("immutable");
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["png", 256, 256]);
  });

  // TEST_SCENARIO: The same agent gets the same icon on every message, and different agents get different icons.
  it("renders the same image for the same seed and differs across seeds", async () => {
    const bytes = async (name: string) =>
      Buffer.from(
        await (await get(publicAvatarPath(avatarSeed(name)))).arrayBuffer(),
      );
    expect((await bytes("triage-bot")).equals(await bytes("triage-bot"))).toBe(
      true,
    );
    expect(
      (await bytes("triage-bot")).equals(await bytes("code-reviewer")),
    ).toBe(false);
  });

  // TEST_SCENARIO: A message posted before a design change keeps its old icon URL. It still gets an image, but not one marked immutable.
  it("still answers an older design version, without the immutable mark", async () => {
    const res = await get(`/avatars/v${AVATAR_VERSION + 1}/42.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).not.toContain("immutable");
  });

  // TEST_SCENARIO: The route takes only a 32-bit number. Anything else, including a name, is not an avatar path.
  it("refuses paths that are not a 32-bit seed", async () => {
    for (const path of [
      `/avatars/v${AVATAR_VERSION}/4294967296.png`,
      `/avatars/v${AVATAR_VERSION}/velvet-comet.png`,
      `/avatars/v${AVATAR_VERSION}/-1.png`,
      `/avatars/latest/1.png`,
    ])
      expect((await get(path)).status, path).toBe(404);
  });

  // TEST_SCENARIO: A caller asking for many fresh seeds at once cannot queue unbounded renders. Past a few renders in flight a miss is refused with a retryable 503, while the requests that got in still succeed.
  it("refuses misses past the renders in flight with a retryable 503", async () => {
    const fresh = createPublicAvatarRoutes();
    const responses = await Promise.all(
      [1, 2, 3, 4].map((seed) =>
        fresh.request(`/avatars/v${AVATAR_VERSION}/${seed}.png`),
      ),
    );
    const statuses = responses.map((res) => res.status);
    expect(statuses.filter((status) => status === 200)).toHaveLength(2);
    const refused = responses.filter((res) => res.status === 503);
    expect(refused).toHaveLength(2);
    for (const res of refused) expect(res.headers.get("retry-after")).toBe("1");
  });

  // TEST_SCENARIO: Many viewers fetching the same new icon at once share one render, so none of them is refused.
  it("shares a render already under way for the same seed", async () => {
    const fresh = createPublicAvatarRoutes();
    const responses = await Promise.all(
      [0, 1, 2, 3].map(() =>
        fresh.request(`/avatars/v${AVATAR_VERSION}/77.png`),
      ),
    );
    expect(responses.map((res) => res.status)).toEqual([200, 200, 200, 200]);
  });
});
