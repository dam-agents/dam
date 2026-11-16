import type { Env, Handler } from "hono";

import { contentDisposition } from "../../../core/content-disposition.js";
import { effectiveContentType } from "../domain/artifact-kind.js";
import type { ShareViewerService } from "../services/share-viewer-service.js";
import {
  isRestricted,
  namesCurrentVersion,
  PRIVATE_NO_STORE,
  type Authorize,
} from "./authorize.js";

export const RAW_ROUTE = "/a/:slug/raw";

export function createRawHandler(
  viewer: ShareViewerService,
  authorize: Authorize,
): Handler<Env, typeof RAW_ROUTE> {
  return async (c) => {
    const slug = c.req.param("slug");
    const authorized = await authorize(c, await viewer.resolveArtifact(slug));
    if (!authorized.ok) return authorized.response;

    const artifact = authorized.artifact;
    if (!namesCurrentVersion(artifact, c.req.query("v")))
      return c.text("not found", 404);

    const blob = await viewer.contentStream(artifact);
    if (!blob) return c.text("not found", 404);

    const contentType = effectiveContentType(
      artifact.fileName,
      blob.contentType,
    );
    const isImage = contentType.startsWith("image/");
    const forceDownload = c.req.query("download") === "1";
    const headers = new Headers({
      "Content-Type": isImage ? contentType : "application/octet-stream",
      "Content-Length": String(blob.sizeBytes),
    });
    if (!isImage || forceDownload) {
      headers.set("Content-Disposition", contentDisposition(artifact.fileName));
    }
    if (isRestricted(artifact)) headers.set("Cache-Control", PRIVATE_NO_STORE);
    return new Response(blob.stream, { headers });
  };
}
