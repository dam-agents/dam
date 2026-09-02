import type { Env, Handler } from "hono";

import type { ShareViewerService } from "../services/share-viewer-service.js";
import { parseVersion } from "./version-query.js";

export const RAW_ROUTE = "/a/:slug/raw";

export function createRawHandler(
  viewer: ShareViewerService,
): Handler<Env, typeof RAW_ROUTE> {
  return async (c) => {
    const slug = c.req.param("slug");
    const resolution = await viewer.resolveArtifact(slug);
    if (resolution.state !== "ok")
      return c.text("not found", resolution.state === "expired" ? 410 : 404);

    const artifact = resolution.artifact;
    const requested = parseVersion(c.req.query("v"));
    const versionArg =
      requested === undefined || requested === artifact.version
        ? undefined
        : requested;
    const safeName = artifact.fileName.replace(/[\r\n"\\]/g, "");

    const blob = await viewer.contentStream(artifact, versionArg);
    if (!blob) return c.text("not found", 404);

    const isImage = blob.contentType.startsWith("image/");
    const forceDownload = c.req.query("download") === "1";
    const headers = new Headers({
      "Content-Type": isImage ? blob.contentType : "application/octet-stream",
      "Content-Length": String(blob.sizeBytes),
    });
    if (!isImage || forceDownload) {
      headers.set("Content-Disposition", `attachment; filename="${safeName}"`);
    }
    return new Response(blob.stream, { headers });
  };
}
