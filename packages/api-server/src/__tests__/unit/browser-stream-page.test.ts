import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { securityHeaders } from "../../apps/api-server/app.js";
import { mountBrowserStreamPage } from "../../apps/api-server/routes/browser-stream.js";

// TEST_OVERVIEW: The browser panel frames the stream client the api-server serves at /api/public/browser-stream/<agent>/. The page is generic code from the api-server image, so it is public, and it must be framable by the platform's own UI and by nothing else.

describe("browser stream page", () => {
  const root = mkdtempSync(join(tmpdir(), "stream-web-"));
  writeFileSync(
    join(root, "index.html"),
    "<!doctype html><title>stream</title>",
  );
  const app = new Hono();
  app.use("*", securityHeaders);
  mountBrowserStreamPage(app, root);

  // TEST_SCENARIO: every API response forbids framing; the stream page alone allows it from the same origin, or the panel's iframe stays blank. A file outside the page's directory is not served.
  it("serves the page, framable from the same origin only", async () => {
    const res = await app.request(
      "/api/public/browser-stream/agent-1/index.html",
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<title>stream</title>");
    expect(res.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(res.headers.get("Content-Security-Policy")).toBe(
      "frame-ancestors 'self'",
    );
    const outside = await app.request(
      "/api/public/browser-stream/agent-1/..%2F..%2Fetc%2Fpasswd",
    );
    expect(outside.status).toBe(404);
  });
});
