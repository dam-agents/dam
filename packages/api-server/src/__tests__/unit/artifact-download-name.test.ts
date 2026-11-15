// TEST_OVERVIEW: An artifact downloads under its own name. The Content-Disposition header carries an ASCII fallback plus the real name in RFC 5987 form, so a file name with a Czech or emoji character downloads instead of answering 500.
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import type { ApiVariables } from "../../core/http-context.js";
import type { ArtifactLibraryServiceImpl } from "../../modules/artifact-library/services/artifact-library-service.js";
import { createArtifactLibraryRoutes } from "../../modules/artifact-library/library-routes.js";
import type { ArtifactService } from "../../modules/artifacts/services/artifact-service.js";
import { contentDisposition } from "../../core/content-disposition.js";

/**
 * TEST_SCENARIO: A file name with a character outside Latin-1 (a Czech `ž`, an
 * emoji) used to throw inside the response header, so the download 500ed and
 * the app showed nothing. Neither form of the header carries a raw CR, LF or
 * quote.
 */
describe("contentDisposition", () => {
  it("keeps a plain ASCII name readable and still names it in UTF-8 form", () => {
    expect(contentDisposition("qa-qft report.exe")).toBe(
      `attachment; filename="qa-qft report.exe"; filename*=UTF-8''qa-qft%20report.exe`,
    );
  });

  it("carries Czech diacritics through an ASCII fallback and a percent-encoded name", () => {
    expect(contentDisposition("qa-qft weird ž.exe")).toBe(
      `attachment; filename="qa-qft weird _.exe"; filename*=UTF-8''qa-qft%20weird%20%C5%BE.exe`,
    );
  });

  it("percent-encodes a non-BMP character as its UTF-8 bytes", () => {
    expect(contentDisposition("graf 🎨.png")).toBe(
      `attachment; filename="graf _.png"; filename*=UTF-8''graf%20%F0%9F%8E%A8.png`,
    );
  });

  it("drops a quote, a backslash and a CR/LF from either form", () => {
    const header = contentDisposition('ev"il\\\r\nname.txt');
    expect(header).toBe(
      `attachment; filename="evilname.txt"; filename*=UTF-8''evilname.txt`,
    );
    expect(header).not.toMatch(/[\r\n]/);
    expect(header.split("filename*=")[0]!.match(/"/g)).toHaveLength(2);
  });

  it("percent-encodes the characters RFC 5987 sets aside", () => {
    expect(contentDisposition("it's (1)*.txt")).toBe(
      `attachment; filename="it's (1)*.txt"; filename*=UTF-8''it%27s%20%281%29%2A.txt`,
    );
  });

  it("falls back to a generic name when nothing is left", () => {
    expect(contentDisposition('"')).toBe(
      `attachment; filename="artifact"; filename*=UTF-8''artifact`,
    );
  });
});

function libraryApp(fileName: string) {
  const lib = {
    resolveContentRef: () =>
      Promise.resolve({
        storageRef: "library/o1/a1/v1/file",
        fileName,
        contentType: "application/octet-stream",
        sizeBytes: 4,
        version: 1,
      }),
  } as unknown as ArtifactLibraryServiceImpl;

  const artifacts = {
    createDownloadUrl: () => Promise.resolve(null),
    getStream: () =>
      Promise.resolve({
        stream: new Blob([Buffer.from("body")]).stream(),
        contentType: "application/octet-stream",
        sizeBytes: 4,
      }),
  } as unknown as ArtifactService;

  const app = new Hono<{ Variables: ApiVariables }>();
  app.use("*", (c, next) => {
    c.set("user", {
      sub: "u1",
      preferredUsername: "u1",
      scopes: [],
      agentIds: "*",
    });
    c.set("surface", "ui");
    return next();
  });
  app.route(
    "/",
    createArtifactLibraryRoutes({
      artifactLibraryFor: () => lib,
      artifacts,
    }),
  );
  return app;
}

describe("artifact download route", () => {
  // TEST_SCENARIO: the reported 500, at the route a browser calls: the relay carries the bytes and the header, with no direct-download URL to hand out.
  it("answers 200 for a Czech file name and names the file in its own form", async () => {
    const res = await libraryApp("qa-qft weird ž.exe").request("/a1/download");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toBe(
      contentDisposition("qa-qft weird ž.exe"),
    );
  });
});
