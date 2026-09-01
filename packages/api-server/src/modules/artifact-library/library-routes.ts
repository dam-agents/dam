import { Hono } from "hono";
import type { UserIdentity } from "api-server-api";

import { securityLog } from "../../core/security-log.js";
import type { ArtifactService } from "../artifacts/services/artifact-service.js";
import { downloadFileName } from "./domain/artifact-kind.js";
import { stagingKey } from "./domain/storage-key.js";
import type { ArtifactLibraryServiceImpl } from "./services/artifact-library-service.js";
import type { ApiVariables } from "../../core/http-context.js";

export interface ArtifactLibraryRoutesDeps {
  artifactLibraryFor: (
    owner: string,
    surface: string,
  ) => ArtifactLibraryServiceImpl;
  artifacts: ArtifactService;
}

export function createArtifactLibraryRoutes(deps: ArtifactLibraryRoutesDeps) {
  const routes = new Hono<{
    Variables: ApiVariables;
  }>();

  routes.post("/upload", async (c) => {
    const user = c.get("user");
    const fileName = c.req.query("filename");
    if (!fileName) return c.json({ error: "filename query is required" }, 400);

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

  routes.get("/:id/download", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const rawVersion = c.req.query("v");
    const version = rawVersion ? Number.parseInt(rawVersion, 10) : undefined;

    const audit = (
      result: "success" | "failure",
      detail: Record<string, unknown>,
      reason?: string,
    ) =>
      securityLog(
        result === "success" ? "info" : "warn",
        "artifact_library.download",
        {
          category: "resource",
          actor: user.sub,
          actorKind: "user",
          target: id,
          result,
          ...(reason ? { reason } : {}),
          detail,
        },
      );

    const ref = await deps
      .artifactLibraryFor(user.sub, c.get("surface"))
      .resolveContentRef(
        id,
        Number.isInteger(version) && version! >= 1 ? version : undefined,
      );
    if (!ref) {
      audit("failure", {}, "artifact or version not found");
      return c.json({ error: "not found" }, 404);
    }

    const filename = downloadFileName(ref.fileName);
    const directUrl = await deps.artifacts.createDownloadUrl(
      ref.storageRef,
      filename,
    );
    if (directUrl) {
      audit("success", { mode: "direct", version: ref.version });
      return c.json({ url: directUrl });
    }

    const blob = await deps.artifacts.getStream(ref.storageRef);
    if (!blob) {
      audit("failure", { mode: "relay" }, "blob missing from the store");
      return c.json({ error: "not found" }, 404);
    }
    audit("success", { mode: "relay", version: ref.version });
    return new Response(blob.stream, {
      headers: {
        "Content-Type": ref.contentType || "application/octet-stream",
        "Content-Length": String(blob.sizeBytes),
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  });

  return routes;
}
