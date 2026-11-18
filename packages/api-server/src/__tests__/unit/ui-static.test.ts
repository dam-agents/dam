import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { securityHeaders } from "../../apps/api-server/app.js";
import { createUiRoutes } from "../../apps/api-server/routes/ui.js";

/**
 * TEST_OVERVIEW: The api-server serves the browser app from its own origin: the SPA's shell for every route the app owns, the files under /assets/ with the caching their content hashes allow, and the headers a static host owed them. A .well-known path or a top-level .txt that no route answers is a 404 rather than the shell.
 */

const SHELL = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../ui/index.html",
);
const ASSET_BYTES = `console.log("${"a".repeat(2048)}");\n`;

function serve(title = "DAM") {
  const root = mkdtempSync(join(tmpdir(), "ui-root-"));
  copyFileSync(SHELL, join(root, "index.html"));
  mkdirSync(join(root, "assets"));
  writeFileSync(join(root, "assets", "app.js"), ASSET_BYTES);
  const ui = createUiRoutes({ root, title });
  if (ui === null) throw new Error("the fixture shell is missing");
  const server = new Hono();
  server.use("*", securityHeaders);
  server.route("/", ui);
  return server;
}

const request = (path: string, headers: Record<string, string> = {}) =>
  serve().request(path, { headers });

describe("the UI the api-server serves", () => {
  it("answers the entry point with the shell, naming the deployment", async () => {
    const res = await request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("<title>DAM</title>");
  });

  it("answers a route the app owns with the shell, so a deep link loads", async () => {
    const res = await request("/agents/some-owner/some-agent");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<title>DAM</title>");
  });

  it("serves a content-hashed asset as immutable", async () => {
    const res = await request("/assets/app.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(await res.text()).toBe(ASSET_BYTES);
  });

  it("makes the shell revalidate on every load", async () => {
    const res = await request("/");
    expect(res.headers.get("cache-control")).toBe(
      "no-cache, no-store, must-revalidate",
    );
  });

  it("carries the headers the static host owed it", async () => {
    const res = await request("/");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("strict-transport-security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
    expect(res.headers.get("content-security-policy")).toBe(
      "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
    );
  });

  /** TEST_SCENARIO: an asset in the app's own size class, over the 1 KB the compression middleware skips below, with a client that accepts gzip. */
  it("compresses an asset when the client accepts gzip", async () => {
    const res = await request("/assets/app.js", { "accept-encoding": "gzip" });
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(res.headers.get("vary")).toContain("Accept-Encoding");
    expect(gunzipSync(new Uint8Array(await res.arrayBuffer())).toString()).toBe(
      ASSET_BYTES,
    );
  });

  /** TEST_SCENARIO: a deploy answers for a bundle it does not have, which happens while two api-server pods share the Service for a few seconds. The browser must get a 404 it can retry, never the shell cached under an asset URL for a year. */
  it("answers a missing asset with a 404 it may retry, not the shell", async () => {
    for (const path of ["/assets/index-NEWHASH.js", "/assets/"]) {
      const res = await request(path);
      expect(res.status).toBe(404);
      expect(res.headers.get("cache-control")).toBe(
        "no-cache, no-store, must-revalidate",
      );
    }
  });

  /** TEST_SCENARIO: a brand title is operator input, and a "$" in it must not read as a replacement pattern that copies the rest of the document into the title. */
  it("writes a title with a dollar sign into the shell verbatim", async () => {
    const res = await serve("Acme $& $' Co").request("/");
    const body = await res.text();
    expect(body).toContain("<title>Acme $&#38; $&#39; Co</title>");
    expect(body.match(/<title>/g)).toHaveLength(1);
  });

  it("answers a file nobody serves, or an API path, with 404 rather than the shell", async () => {
    for (const path of [
      "/robots.txt",
      "/.well-known/nothing",
      "/api/unknown",
    ]) {
      expect((await request(path)).status).toBe(404);
    }
  });

  it("serves nothing when the build has no shell, as in a dev server", () => {
    const root = mkdtempSync(join(tmpdir(), "ui-root-"));
    expect(createUiRoutes({ root, title: "DAM" })).toBeNull();
  });
});
