import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { createByLinkHostGate } from "../../modules/artifact-library/viewer/by-link-host-gate.js";
import { createContentApp } from "../../modules/artifact-library/viewer/content-app.js";
import { createShareViewerApp } from "../../modules/artifact-library/viewer/viewer-app.js";
import type {
  FolderResolution,
  ShareViewerService,
  SharedResolution,
} from "../../modules/artifact-library/services/share-viewer-service.js";
import type { ArtifactRow } from "../../modules/artifact-library/infrastructure/artifact-library-repository.js";

function artifactRow(overrides: Partial<ArtifactRow> = {}): ArtifactRow {
  return {
    id: "a1",
    owner: "o1",
    agentId: "agent-1",
    folderId: null,
    title: "Weekly digest",
    slug: "slug-a",
    kind: "html",
    contentType: "text/html",
    fileName: "digest.html",
    storageRef: "library/o1/a1/v1/digest.html",
    sizeBytes: 64,
    version: 1,
    visibility: "public",
    expiresAt: null,
    viewCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fakeViewer(
  overrides: Partial<ShareViewerService>,
): ShareViewerService {
  return {
    resolveArtifact: () => Promise.resolve({ state: "not-found" }),
    resolveFolder: () =>
      Promise.resolve({ state: "not-found" } as FolderResolution),
    meta: () => Promise.resolve({ contentType: "text/html", sizeBytes: 40 }),
    content: () =>
      Promise.resolve({
        content: Buffer.from("<h1>hello</h1><script>alert(1)</script>"),
        contentType: "text/html",
        sizeBytes: 40,
      }),
    contentStream: () =>
      Promise.resolve({
        stream: new Blob([
          Buffer.from("<h1>hello</h1><script>alert(1)</script>"),
        ]).stream(),
        contentType: "text/html",
        sizeBytes: 40,
      }),
    versionCount: () => Promise.resolve(1),
    recordView: () => {},
    ...overrides,
  };
}

function publicViewer(overrides: Partial<ShareViewerService> = {}) {
  return fakeViewer({
    resolveArtifact: () =>
      Promise.resolve({
        state: "ok",
        artifact: artifactRow(),
      } satisfies SharedResolution),
    ...overrides,
  });
}

function appWith(viewer: ShareViewerService) {
  return createShareViewerApp({
    viewer,
    brandName: "Platform",
    uiBaseUrl: "http://app.localhost",
    contentBaseUrl: "https://content.example.com",
  });
}

function contentAppWith(viewer: ShareViewerService) {
  return createContentApp({
    viewer,
    shareBaseUrl: "https://share.example.com",
  });
}

describe("share viewer app", () => {
  it("frames a public artifact from the content origin, never inline", async () => {
    const app = appWith(
      publicViewer({ versionCount: () => Promise.resolve(3) }),
    );
    const res = await app.request("/a/slug-a?v=2");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("sandbox=");
    expect(html).toContain('src="https://content.example.com/a/slug-a?v=2"');
    expect(html).not.toContain("srcdoc=");
    expect(html).not.toContain("<h1>hello</h1>");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("Content-Security-Policy")).not.toContain("sandbox");
  });

  it("falls back to the current version when the requested one does not exist", async () => {
    const app = appWith(
      publicViewer({ versionCount: () => Promise.resolve(1) }),
    );
    const html = await (await app.request("/a/slug-a?v=7")).text();
    expect(html).toContain('src="https://content.example.com/a/slug-a?v=1"');
  });

  it("404s a private/unknown slug and 410s an expired one", async () => {
    const app = appWith(fakeViewer({}));
    expect((await app.request("/a/nope")).status).toBe(404);

    const expiredApp = appWith(
      fakeViewer({
        resolveArtifact: () =>
          Promise.resolve({ state: "expired", withinGrace: true }),
      }),
    );
    expect((await expiredApp.request("/a/slug-a")).status).toBe(410);
  });

  it("serves raw bytes as attachment except inline images", async () => {
    const app = appWith(publicViewer());
    const raw = await app.request("/a/slug-a/raw");
    expect(raw.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(raw.headers.get("Content-Disposition")).toContain("attachment");
    expect(await raw.text()).toContain("<h1>hello</h1>");

    const imageApp = appWith(
      fakeViewer({
        resolveArtifact: () =>
          Promise.resolve({
            state: "ok",
            artifact: artifactRow({ kind: "binary", contentType: "image/png" }),
          } satisfies SharedResolution),
        meta: () => Promise.resolve({ contentType: "image/png", sizeBytes: 1 }),
        contentStream: () =>
          Promise.resolve({
            stream: new Blob([Buffer.from([0x89])]).stream(),
            contentType: "image/png",
            sizeBytes: 1,
          }),
      }),
    );
    const image = await imageApp.request("/a/slug-a/raw");
    expect(image.headers.get("Content-Type")).toBe("image/png");
    expect(image.headers.get("Content-Disposition")).toBeNull();
  });

  it("CSP-sandboxes raw responses so an inline SVG can't script the share origin", async () => {
    const app = appWith(
      fakeViewer({
        resolveArtifact: () =>
          Promise.resolve({
            state: "ok",
            artifact: artifactRow({
              kind: "binary",
              contentType: "image/svg+xml",
            }),
          } satisfies SharedResolution),
        contentStream: () =>
          Promise.resolve({
            stream: new Blob([
              Buffer.from("<svg><script>alert(1)</script></svg>"),
            ]).stream(),
            contentType: "image/svg+xml",
            sizeBytes: 37,
          }),
      }),
    );
    const raw = await app.request("/a/slug-a/raw");
    expect(raw.headers.get("Content-Disposition")).toBeNull();
    expect(raw.headers.get("Content-Security-Policy")).toContain("sandbox");
  });

  it("redirects everything that isn't a share route to the app origin", async () => {
    const app = appWith(fakeViewer({}));
    const res = await app.request("/anything/else");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("http://app.localhost");
  });
});

describe("content app", () => {
  it("serves the inner document with framing pinned to the share origin and no cookie", async () => {
    const app = contentAppWith(publicViewer());
    const res = await app.request("/a/slug-a");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("<h1>hello</h1><script>alert(1)</script>");
    expect(html).toContain('<base target="_blank">');
    expect(res.headers.get("Content-Security-Policy")).toBe(
      "frame-ancestors https://share.example.com",
    );
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("renders images through the relative raw URL on the same host", async () => {
    const app = contentAppWith(
      publicViewer({
        resolveArtifact: () =>
          Promise.resolve({
            state: "ok",
            artifact: artifactRow({ kind: "binary", contentType: "image/png" }),
          } satisfies SharedResolution),
        meta: () => Promise.resolve({ contentType: "image/png", sizeBytes: 1 }),
      }),
    );
    const html = await (await app.request("/a/slug-a?v=1")).text();
    expect(html).toContain('<img src="/a/slug-a/raw?v=1"');
  });

  it("renders the download card instead of buffering oversized text", async () => {
    const big = 50 * 1024 * 1024;
    const app = contentAppWith(
      publicViewer({
        resolveArtifact: () =>
          Promise.resolve({
            state: "ok",
            artifact: artifactRow({ sizeBytes: big }),
          } satisfies SharedResolution),
        meta: () =>
          Promise.resolve({ contentType: "text/html", sizeBytes: big }),
        content: (_a, _v, maxBytes) =>
          maxBytes !== undefined && big > maxBytes
            ? Promise.resolve(null)
            : Promise.reject(new Error("should have been size-capped")),
      }),
    );
    const res = await app.request("/a/slug-a");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Download");
    expect(html).not.toContain("<h1>hello</h1>");
  });

  it("serves raw bytes with a CSP sandbox and the share origin as the only framer", async () => {
    const app = contentAppWith(publicViewer());
    const raw = await app.request("/a/slug-a/raw");
    expect(raw.status).toBe(200);
    expect(raw.headers.get("Content-Disposition")).toContain("attachment");
    expect(raw.headers.get("Content-Security-Policy")).toBe(
      "sandbox; frame-ancestors https://share.example.com",
    );
  });

  it("answers plain 404 text for a private slug and for every non-content path", async () => {
    const app = contentAppWith(fakeViewer({}));
    for (const path of ["/a/nope", "/f/anything", "/auth/login", "/"]) {
      const res = await app.request(path);
      expect(res.status).toBe(404);
      expect(res.headers.get("Location")).toBeNull();
      expect(res.headers.get("Content-Type")).toContain("text/plain");
    }
  });
});

describe("by-link host gate", () => {
  function gatedApp() {
    const viewer = new Hono();
    viewer.get("/a/:slug", (c) => c.text("viewer"));
    const content = new Hono();
    content.get("/a/:slug", (c) => c.text("content"));
    const app = new Hono();
    app.use(
      "*",
      createByLinkHostGate({
        share: { baseUrl: "https://share.example.com", app: viewer },
        content: { baseUrl: "https://content.example.com:4444", app: content },
      }),
    );
    app.get("/api/secret", (c) => c.text("app-route"));
    return app;
  }

  it("dispatches content-host requests to the content app and nowhere else", async () => {
    const app = gatedApp();
    const res = await app.request("/a/slug", {
      headers: { host: "content.example.com" },
    });
    expect(await res.text()).toBe("content");
    const secret = await app.request("/api/secret", {
      headers: { host: "content.example.com" },
    });
    expect(await secret.text()).not.toBe("app-route");
  });

  it("dispatches share-host requests to the viewer — case- and port-insensitively", async () => {
    const app = gatedApp();
    for (const host of [
      "share.example.com",
      "SHARE.Example.com",
      "share.example.com:4444",
    ]) {
      const res = await app.request("/a/slug", { headers: { host } });
      expect(await res.text()).toBe("viewer");
    }
  });

  it("share-host requests can never reach app routes", async () => {
    const app = gatedApp();
    const res = await app.request("/api/secret", {
      headers: { host: "share.example.com" },
    });
    expect(res.status).not.toBe(200);
    expect(await res.text()).not.toBe("app-route");
  });

  it("app-host requests fall through to app routes, never the viewer", async () => {
    const app = gatedApp();
    const secret = await app.request("/api/secret", {
      headers: { host: "app.example.com" },
    });
    expect(await secret.text()).toBe("app-route");
    const viewerPath = await app.request("/a/slug", {
      headers: { host: "app.example.com" },
    });
    expect(viewerPath.status).toBe(404);
  });

  it("a superstring or absent host never matches the share host", async () => {
    const app = gatedApp();
    const hostVariants: Array<Record<string, string>> = [
      { host: "share.example.com.evil.net" },
      { host: "xshare.example.com" },
      {},
    ];
    for (const headers of hostVariants) {
      const res = await app.request("/api/secret", { headers });
      expect(await res.text()).toBe("app-route");
    }
  });
});
