import { bodyLimit } from "hono/body-limit";
import { Hono } from "hono";
import {
  satelliteFileOpMutates,
  satelliteFileOpSchema,
  satelliteNameSchema,
  type SatelliteFileOp,
  type SatelliteFileErrno,
} from "api-server-api";
import { getLogger } from "../../../core/logger.js";
import { isOnline } from "../domain/admission.js";
import type { SatellitesRepository } from "../infrastructure/satellites-repository.js";
import {
  FILE_OP_DEADLINE_MS,
  type SatelliteFileChannel,
} from "../services/file-channel.js";

const OP_BODY_BYTES = 2 * 1024 * 1024;

/**
 * UNIT_BOUNDARY_DESCRIPTION: The two requests an Agent's mount server makes on
 * the Agent's own path, under the identity the Agent already has and no
 * credential of its own. The listing is what the mount polls and what presence
 * is recorded from; an operation is checked here — the grant, the kind, that the
 * machine is reachable, that the grant was not just revoked and that a change is
 * allowed — and then queued on the file channel to be answered on this same
 * request. Every answer, the platform's refusals included, is a FUSE errno, so
 * the mount hands the Agent's tools the error the platform means rather than a
 * status it has to guess from.
 *
 * A store failure answers `EIO` and is logged by its code alone: an ioredis error
 * carries the command and its arguments, which is an operation's path or a
 * write's bytes, and neither may reach a log or a response. The operation body's
 * own limit runs before the app's global one, because a limiter buffers what it
 * reads up to its own ceiling before passing the request on.
 */
export function createAgentFileChannelRoutes(deps: {
  ownerOf: (agentId: string) => Promise<string | null>;
  repo: Pick<
    SatellitesRepository,
    "grantedSatellite" | "grantedFilesSatellites"
  >;
  fileChannel: Pick<
    SatelliteFileChannel,
    "seen" | "isRevoked" | "enqueue" | "awaitResult"
  >;
  now?: () => number;
}) {
  const now = deps.now ?? (() => Date.now());
  const routes = new Hono();
  const noStore = { "cache-control": "no-store" } as const;
  const statusOf = (errno: SatelliteFileErrno): 200 | 403 | 503 =>
    errno === "EACCES" ? 403 : errno === "EHOSTDOWN" ? 503 : 200;

  function failed(where: string, err: unknown): void {
    const code = (err as { code?: unknown } | null)?.code;
    const name = (err as { name?: unknown } | null)?.name;
    getLogger().warn(
      {
        where,
        code: typeof code === "string" ? code : (name ?? "Error"),
      },
      "satellites.file-channel.failed",
    );
  }

  routes.get("/api/agents/:id/satellite-files", async (c) => {
    const agentId = c.req.param("id")!;
    try {
      const owner = await deps.ownerOf(agentId);
      if (owner === null)
        return c.json({ ok: false, errno: "ENOENT" }, 404, noStore);
      const satellites = await deps.repo.grantedFilesSatellites(agentId, owner);
      await deps.fileChannel.seen(agentId).catch(() => undefined);
      return c.json(
        {
          satellites: satellites.map((satellite) => ({
            name: satellite.name,
            writable: satellite.writable,
            online: satellite.online,
          })),
        },
        200,
        noStore,
      );
    } catch (err) {
      failed("list", err);
      return c.json({ ok: false, errno: "EHOSTDOWN" }, 503, noStore);
    }
  });

  routes.post(
    "/api/agents/:id/satellite-files/:name/op",
    bodyLimit({
      maxSize: OP_BODY_BYTES,
      onError: (c) => c.json({ ok: false, errno: "EINVAL" }, 413, noStore),
    }),
    async (c) => {
      const agentId = c.req.param("id")!;
      try {
        const owner = await deps.ownerOf(agentId);
        if (owner === null)
          return c.json({ ok: false, errno: "ENOENT" }, 404, noStore);

        const name = satelliteNameSchema.safeParse(c.req.param("name"));
        const body: unknown = await c.req.json().catch(() => null);
        const operation = satelliteFileOpSchema.safeParse(body);
        if (!name.success || !operation.success)
          return c.json({ ok: false, errno: "EINVAL" }, 400, noStore);

        const satellite = await deps.repo.grantedSatellite(
          agentId,
          owner,
          name.data,
        );
        if (satellite === null || satellite.kind !== "files")
          return c.json({ ok: false, errno: "EACCES" }, 403, noStore);
        if (!isOnline(satellite, new Date(now())) || satellite.draining)
          return c.json({ ok: false, errno: "EHOSTDOWN" }, 503, noStore);
        if (await deps.fileChannel.isRevoked(owner, name.data, agentId))
          return c.json({ ok: false, errno: "EACCES" }, 403, noStore);
        if (satelliteFileOpMutates(operation.data) && !satellite.filesWritable)
          return c.json({ ok: false, errno: "EROFS" }, 200, noStore);

        const decoded = decode(operation.data);
        const queued = await deps.fileChannel.enqueue(
          owner,
          name.data,
          satellite.incarnation,
          agentId,
          decoded.op,
          decoded.path,
          decoded.args,
          decoded.data,
          now() + FILE_OP_DEADLINE_MS,
        );
        if (!queued.ok)
          return c.json(
            { ok: false, errno: queued.errno },
            statusOf(queued.errno),
            noStore,
          );
        const answer = await deps.fileChannel.awaitResult(queued.id);
        return c.json(answer, 200, noStore);
      } catch (err) {
        failed("op", err);
        return c.json({ ok: false, errno: "EIO" }, 200, noStore);
      }
    },
  );

  return routes;
}

function decode(operation: SatelliteFileOp): {
  op: string;
  path?: string;
  args?: Record<string, unknown>;
  data?: Buffer;
} {
  const fields = operation as unknown as Record<string, unknown>;
  const { op, path: at, from, data, ...rest } = fields;
  const path =
    typeof from === "string" ? from : typeof at === "string" ? at : undefined;
  const carried =
    typeof data === "string" ? Buffer.from(data, "base64") : undefined;
  return {
    op: String(op),
    ...(path === undefined ? {} : { path }),
    ...(Object.keys(rest).length === 0 ? {} : { args: rest }),
    ...(carried === undefined ? {} : { data: carried }),
  };
}
