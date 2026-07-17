import { Hono } from "hono";
import type { UserIdentity } from "api-server-api";

import { securityLog } from "../../core/security-log.js";
import type { ArtifactService } from "../artifacts/services/artifact-service.js";
import { stagingKey } from "./domain/storage-key.js";
import type { ArtifactLibraryServiceImpl } from "./services/artifact-library-service.js";

export interface ArtifactLibraryRoutesDeps {
  /** Owner-scoped library service, bound to the request's user. */
  artifactLibraryFor: (owner: string) => ArtifactLibraryServiceImpl;
  artifacts: ArtifactService;
}

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[\r\n"\\]/g, "").trim();
  return cleaned.length > 0 ? cleaned : "artifact";
}

/** Non-tRPC library routes on the authenticated app origin: binary upload
 *  (browser → api-server → store, avoiding store CORS) and download
 *  (presigned direct link as JSON, or relay — the candidate-route pattern). */
export function createArtifactLibraryRoutes(deps: ArtifactLibraryRoutesDeps) {
  const routes = new Hono<{
    Variables: { user: UserIdentity; roles: string[] };
  }>();

  routes.post("/api/artifact-library/upload", async (c) => {
    const user = c.get("user");
    const fileName = c.req.query("filename");
    if (!fileName) return c.json({ error: "filename query is required" }, 400);

    // Requires Content-Length so a chunked-encoding client can't make us
    // buffer an unbounded body before the cap check (the import proxy makes
    // the same call); the post-read check backstops a lying header.
    const lengthHeader = c.req.header("content-length");
    if (!lengthHeader) {
      return c.json({ error: "Content-Length required" }, 411);
    }
    const declared = Number.parseInt(lengthHeader, 10);
    if (!Number.isFinite(declared) || declared < 0) {
      return c.json({ error: "invalid Content-Length" }, 400);
    }
    if (declared > deps.artifacts.maxBytes) {
      return c.json(
        { error: `artifact exceeds the ${deps.artifacts.maxBytes}-byte cap` },
        413,
      );
    }
    const body = Buffer.from(await c.req.arrayBuffer());
    if (body.byteLength === 0) return c.json({ error: "empty body" }, 400);
    if (body.byteLength > deps.artifacts.maxBytes) {
      return c.json(
        { error: `artifact exceeds the ${deps.artifacts.maxBytes}-byte cap` },
        413,
      );
    }

    const key = stagingKey(user.sub, fileName);
    await deps.artifacts.put({
      key,
      content: body,
      contentType: c.req.header("content-type") ?? "application/octet-stream",
    });
    return c.json({ uploadRef: key });
  });

  routes.get("/api/artifact-library/:id/download", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const rawVersion = c.req.query("v");
    const version = rawVersion ? Number.parseInt(rawVersion, 10) : undefined;

    const ref = await deps
      .artifactLibraryFor(user.sub)
      .resolveContentRef(
        id,
        Number.isInteger(version) && version! >= 1 ? version : undefined,
      );
    if (!ref) return c.json({ error: "not found" }, 404);

    const filename = sanitizeFilename(ref.fileName);
    // Direct link as JSON rather than a 302 — the UI fetches with a bearer
    // token and a cross-origin redirect inside fetch() would be CORS-blocked.
    const directUrl = await deps.artifacts.createDownloadUrl(
      ref.storageRef,
      filename,
    );
    securityLog("info", "artifact_library.download", {
      category: "resource",
      actor: user.sub,
      actorKind: "user",
      target: id,
      result: "success",
      detail: { mode: directUrl ? "direct" : "relay" },
    });
    if (directUrl) return c.json({ url: directUrl });

    const blob = await deps.artifacts.get(ref.storageRef);
    if (!blob) return c.json({ error: "not found" }, 404);
    return new Response(new Uint8Array(blob.content), {
      headers: {
        "Content-Type": blob.contentType || "application/octet-stream",
        "Content-Length": String(blob.sizeBytes),
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  });

  return routes;
}
