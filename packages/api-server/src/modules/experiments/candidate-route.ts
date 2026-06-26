import { Hono } from "hono";
import type { ExperimentsService, UserIdentity } from "api-server-api";

import type { ArtifactService } from "../artifacts/services/artifact-service.js";
import { securityLog } from "../../core/security-log.js";

export interface CandidateRoutesDeps {
  /** Owner-scoped experiments service, bound to the request's user. */
  experimentsFor: (owner: string) => ExperimentsService;
  artifacts: ArtifactService;
}

/** Strip anything that could break out of the quoted `filename="…"` token or
 *  inject a header line. The stored basename is server-chosen, but defend the
 *  Content-Disposition value regardless. */
function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[\r\n"\\]/g, "").trim();
  return cleaned.length > 0 ? cleaned : "candidate";
}

/** Serves a Run's Candidate artifact for download. Owner-scoped through the
 *  experiments service (a non-owned experiment reads back as 404), so the
 *  opaque artifact key is never trusted from the client — the run is resolved
 *  first, then its stored `candidateRef` addresses the blob. */
export function createCandidateRoutes(deps: CandidateRoutesDeps) {
  const routes = new Hono<{
    Variables: { user: UserIdentity; roles: string[] };
  }>();

  routes.get(
    "/api/experiments/:experimentId/runs/:runId/candidate",
    async (c) => {
      const user = c.get("user");
      const experimentId = c.req.param("experimentId");
      const runId = c.req.param("runId");

      const experiment = await deps
        .experimentsFor(user.sub)
        .getWithRuns(experimentId);
      if (!experiment) return c.json({ error: "not found" }, 404);

      const run = experiment.arms
        .flatMap((arm) => arm.runs)
        .find((r) => r.id === runId);
      if (!run?.candidateRef) return c.json({ error: "not found" }, 404);

      const artifact = await deps.artifacts.get(run.candidateRef);
      if (!artifact) return c.json({ error: "not found" }, 404);

      securityLog("info", "experiment.candidate_download", {
        category: "resource",
        actor: user.sub,
        actorKind: "user",
        target: experimentId,
        result: "success",
        detail: { runId, candidateRef: run.candidateRef },
      });

      const filename = sanitizeFilename(
        run.candidateRef.split("/").pop() ?? "",
      );
      // Pipe the blob to the client rather than copying it into a fresh buffer.
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(artifact.content);
          controller.close();
        },
      });
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": artifact.contentType || "application/octet-stream",
          "Content-Length": String(artifact.sizeBytes),
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    },
  );

  return routes;
}
