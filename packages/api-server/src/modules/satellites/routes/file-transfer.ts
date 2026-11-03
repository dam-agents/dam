import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { Hono, type Context } from "hono";
import {
  SATELLITE_FILE_MAX_BYTES,
  satelliteFileNameSchema,
  satelliteNameSchema,
  type SatelliteFileWritten,
} from "api-server-api";
import type { ApiVariables } from "../../../core/http-context.js";
import { getLogger } from "../../../core/logger.js";
import type { JobRow } from "../domain/types.js";
import type { SatelliteWorkspaceFiles } from "../infrastructure/agent-workspace-files.js";
import type { SatellitesRepository } from "../infrastructure/satellites-repository.js";

type AppEnv = { Variables: ApiVariables };

const SATELLITE_FILE_DIR = ".dam/satellite-files";

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Where a downloaded file lands in the Agent's
 * workspace, decided by the platform and not by the machine. A Job's number is
 * unique per Satellite, so two downloads never collide, and the machine only
 * ever names the last segment.
 */
function destinationOf(job: JobRow, name: string): string {
  return `${SATELLITE_FILE_DIR}/${job.satellite}-${job.sequence}/${name}`;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The workspace path an Agent asks the platform to
 * send. The runtime resolves it and refuses anything outside the workspace, but
 * the platform refuses a `..` segment first, so the machine never sees a path
 * the runtime would have to be trusted to normalize.
 */
function workspacePathOf(raw: string | undefined): string | null {
  if (raw === undefined || raw === "" || raw.length > 1024) return null;
  if (raw.includes("\0")) return null;
  if (raw.split("/").includes("..")) return null;
  return raw;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: One file crossing the trust boundary in either
 * direction, carried by its own request rather than by a Job's result.
 *
 * A transfer is authorised by a Job that is running right now on that Satellite
 * and nothing else: the platform reads the Job's own Agent, so a machine can
 * only write into the workspace of an Agent whose call it is serving this
 * moment, and only where the platform puts it. There is no tool name in the
 * contract to check against — the same endpoint serves whichever tool of a
 * machine moves bytes — so the direction is the machine's report and the Job
 * row is the audit: which file, how large, and which way.
 *
 * A transfer is buffered whole, so its ceiling is what one api-server replica
 * may hold: 50 MB in, plus the base64 the runtime's write takes. The upgrade
 * path, if that costs too much, is `import-proxy`'s streaming into the
 * runtime's `/api/import`, which needs a tar framing on both sides.
 */
export function createSatelliteFileRoutes(deps: {
  repo: SatellitesRepository;
  files: SatelliteWorkspaceFiles;
}) {
  const routes = new Hono<AppEnv>();

  async function jobOf(c: Context<AppEnv>): Promise<JobRow | Response> {
    const user = c.get("user");
    if (!user.scopes.includes("satellites:serve") || user.agentIds !== "*")
      return c.json(
        {
          error: "forbidden",
          message:
            "a satellite file transfer needs a serve key with no agent binding",
        },
        403,
      );
    const name = satelliteNameSchema.safeParse(c.req.param("name"));
    const sequence = Number(c.req.param("sequence"));
    if (!name.success || !Number.isInteger(sequence) || sequence < 1)
      return c.json({ error: "not a job reference" }, 400);
    const job = await deps.repo.getJob(user.sub, name.data, sequence);
    if (job === null) return c.json({ error: "no such job" }, 404);
    if (job.status !== "running")
      return c.json(
        {
          error: `${name.data}#${sequence} is ${job.status}, not running`,
        },
        409,
      );
    return job;
  }

  async function bodyUpTo(
    body: ReadableStream<Uint8Array> | null,
    cap: number,
  ): Promise<Buffer | null> {
    if (body === null) return Buffer.alloc(0);
    const chunks: Buffer[] = [];
    let seen = 0;
    for await (const chunk of Readable.fromWeb(
      body as Parameters<typeof Readable.fromWeb>[0],
    )) {
      const bytes = chunk as Buffer;
      seen += bytes.length;
      if (seen > cap) return null;
      chunks.push(bytes);
    }
    return Buffer.concat(chunks);
  }

  routes.post(
    "/api/satellites/:name/jobs/:sequence/file",
    async (c): Promise<Response> => {
      const job = await jobOf(c);
      if (job instanceof Response) return job;

      const name = satelliteFileNameSchema.safeParse(c.req.query("name") ?? "");
      if (!name.success)
        return c.json(
          { error: name.error.issues[0]?.message ?? "bad file name" },
          400,
        );

      const declared = Number(c.req.header("content-length") ?? "");
      if (!Number.isInteger(declared) || declared < 0)
        return c.json({ error: "Content-Length required" }, 411);
      if (declared > SATELLITE_FILE_MAX_BYTES)
        return c.json(
          {
            error: `a transfer carries at most ${SATELLITE_FILE_MAX_BYTES} bytes`,
          },
          413,
        );

      const bytes = await bodyUpTo(c.req.raw.body, SATELLITE_FILE_MAX_BYTES);
      if (bytes === null)
        return c.json(
          {
            error: `a transfer carries at most ${SATELLITE_FILE_MAX_BYTES} bytes`,
          },
          413,
        );

      let written: string;
      try {
        written = await deps.files.write({
          agentId: job.agentId,
          path: destinationOf(job, name.data),
          bytes,
        });
      } catch (err) {
        getLogger().warn(
          {
            agentId: job.agentId,
            path: destinationOf(job, name.data),
            error: err instanceof Error ? err.message : String(err),
          },
          "satellites.file.write.failed",
        );
        return c.json({ error: "the agent's workspace refused the file" }, 502);
      }
      const result: SatelliteFileWritten = {
        path: written,
        size: bytes.length,
        sha256: sha256(bytes),
      };
      return c.json(result);
    },
  );

  routes.get(
    "/api/satellites/:name/jobs/:sequence/file",
    async (c): Promise<Response> => {
      const job = await jobOf(c);
      if (job instanceof Response) return job;

      const path = workspacePathOf(c.req.query("path"));
      if (path === null)
        return c.json(
          { error: "path is a workspace path, with no .. segment" },
          400,
        );

      const read = await deps.files.read({ agentId: job.agentId, path });
      if (!read.ok) {
        if (read.reason === "unreachable")
          getLogger().warn(
            { agentId: job.agentId, path },
            "satellites.file.read.failed",
          );
        return read.reason === "not-found"
          ? c.json({ error: `the agent's workspace has no ${path}` }, 404)
          : read.reason === "too-large"
            ? c.json(
                {
                  error: `${path} is over the ${SATELLITE_FILE_MAX_BYTES}-byte per-file cap`,
                },
                413,
              )
            : c.json({ error: "the agent's workspace could not be read" }, 502);
      }

      return c.body(new Uint8Array(read.bytes), 200, {
        "content-type": "application/octet-stream",
        "content-length": String(read.bytes.length),
      });
    },
  );

  return routes;
}
