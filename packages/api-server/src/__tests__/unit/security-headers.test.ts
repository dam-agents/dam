import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { securityHeaders } from "../../apps/api-server/app.js";

/*
 * TEST_OVERVIEW: A response passing through this middleware leaves with the
 * baseline security headers and a Cache-Control that forbids caching, unless
 * the route chose its own caching (brand icons are public for five minutes) or
 * the response is a 304 whose cached copy the client must keep.
 */
describe("securityHeaders", () => {
  const app = new Hono();
  app.use("*", securityHeaders);
  app.get("/plain", (c) => c.json({ ok: true }));
  app.get("/cached", (c) => {
    c.header("Cache-Control", "public, max-age=300");
    return c.body("icon");
  });
  app.get("/conditional", (c) => c.body(null, 304));

  /*
   * TEST_SCENARIO: A route that sets no Cache-Control gets the no-store
   * default; ZAP's cache-control rule wants all three directives present.
   */
  it("defaults Cache-Control to no-store", async () => {
    const res = await app.request("/plain");
    expect(res.headers.get("Cache-Control")).toBe(
      "no-cache, no-store, must-revalidate",
    );
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  /* TEST_SCENARIO: A route that sets its own Cache-Control keeps it. */
  it("keeps a route's own Cache-Control", async () => {
    const res = await app.request("/cached");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
  });

  /*
   * TEST_SCENARIO: A 304 sets no Cache-Control on its conditional branch (the
   * brand-icon routes do this). Stamping no-store would tell the client to drop
   * the cached copy it just revalidated, so the middleware leaves 304 alone.
   */
  it("leaves a 304 without Cache-Control", async () => {
    const res = await app.request("/conditional");
    expect(res.status).toBe(304);
    expect(res.headers.get("Cache-Control")).toBeNull();
  });
});
