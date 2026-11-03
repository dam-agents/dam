import { createHash } from "node:crypto";
import { basename } from "node:path";
import { Readable, Transform } from "node:stream";
import { Hono, type Context } from "hono";
import {
  SATELLITE_FILE_MAX_BYTES,
  SATELLITE_TRANSFER_CLAIM_HEADER,
  satelliteFileNameSchema,
  satelliteNameSchema,
  satelliteTransferTokenSchema,
  type SatelliteFileWritten,
} from "api-server-api";
import type { ApiVariables } from "../../../core/http-context.js";
import { getLogger } from "../../../core/logger.js";
import type { JobRow } from "../domain/types.js";
import { transferTokenHash } from "../domain/transfer-token.js";
import type { AgentTransfer } from "../infrastructure/agent-transfer.js";
import type { SatellitesRepository } from "../infrastructure/satellites-repository.js";

type AppEnv = { Variables: ApiVariables };
type Direction = "download" | "upload";

const TRANSFER_ROOT = ".dam/satellite-files";
const RE_CHECK_MS = 1000;

/**
 * UNIT_BOUNDARY_DESCRIPTION: Where a downloaded file lands in the Agent's
 * workspace, chosen by the platform. The directory is the Job and the claim
 * that served it, so two transfers never name the same file even when a
 * Satellite is removed and its sequences start again, and the file's own name
 * is the last segment of the path the Agent asked for — never a name the
 * machine chose.
 */
function destinationOf(job: JobRow, claim: string, name: string): string {
  return `${TRANSFER_ROOT}/${job.satellite}-${job.sequence}-${claim}/${name}`;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The workspace path an Agent asked to send, which
 * is the only workspace path a transfer may read. The runtime resolves it
 * again and refuses anything outside the workspace; here a `..` segment or a
 * NUL is refused before the runtime ever sees it.
 */
function workspacePathOf(args: Record<string, unknown>): string | null {
  const raw = args.workspacePath;
  if (typeof raw !== "string" || raw === "" || raw.length > 1024) return null;
  if (raw.includes("\0") || raw.split("/").includes("..")) return null;
  return raw;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: One file crossing the trust boundary in either
 * direction, carried by its own request rather than by a Job's result.
 *
 * A request authorises nothing by itself. It names a Job, presents the token
 * that Job's claim was issued, and the platform reads the direction frozen on
 * that Job when its call was admitted, and both paths from the Job's own
 * arguments — the Agent's call, not the machine's word. A `download` therefore
 * lands the file the Agent asked for, at a path the platform chose, and an
 * `upload` reads the workspace file the Agent named and no other. The token is
 * consumed by one atomic statement, which is also the check that the Job is
 * still running: one Job moves one file each way, a download cannot land after
 * it ended, and an upload's stream is cut within one re-check interval.
 *
 * A transfer is streamed end to end, so the cap is counted while the bytes
 * move and a body over it is cut off, not received and then refused.
 */
export function createSatelliteFileRoutes(deps: {
  repo: SatellitesRepository;
  transferFor: (agentId: string) => AgentTransfer;
  cap?: number;
  reCheckMs?: number;
}) {
  const routes = new Hono<AppEnv>();
  const cap = deps.cap ?? SATELLITE_FILE_MAX_BYTES;
  const reCheckMs = deps.reCheckMs ?? RE_CHECK_MS;

  const audit = (
    level: "info" | "warn",
    fields: Record<string, unknown>,
  ): void => {
    getLogger()[level](fields, "satellites.transfer");
  };

  async function authorize(
    c: Context<AppEnv>,
    direction: Direction,
  ): Promise<{ job: JobRow; token: string } | Response> {
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
    const token = satelliteTransferTokenSchema.safeParse(
      c.req.header(SATELLITE_TRANSFER_CLAIM_HEADER) ?? "",
    );
    if (!name.success || !token.success || !Number.isInteger(sequence))
      return c.json({ error: "bad_transfer_request" }, 400);

    const job = await deps.repo.getJob(user.sub, name.data, sequence);
    if (job === null || job.status !== "running")
      return c.json({ error: "no_running_job" }, 409);

    if (job.transferDirection !== direction)
      return c.json({ error: "wrong_direction" }, 403);

    const hash = await deps.repo.transferTokenHashOf(
      user.sub,
      name.data,
      sequence,
    );
    if (hash === null || hash !== transferTokenHash(token.data))
      return c.json({ error: "not_the_claimant" }, 403);

    return { job, token: token.data };
  }

  /**
   * UNIT_BOUNDARY_DESCRIPTION: Spends the claim's transfer capability. It is
   * the only place a transfer is allowed to complete, so "the Job is still
   * running" and "this claim has not transferred yet" hold in the same instant.
   */
  async function spend(
    owner: string,
    job: JobRow,
    token: string,
    direction: Direction,
  ): Promise<boolean> {
    const spent = await deps.repo.consumeTransfer(
      owner,
      job.satellite,
      job.sequence,
      token,
    );
    audit(spent === null ? "warn" : "info", {
      direction,
      owner,
      satellite: job.satellite,
      sequence: job.sequence,
      agentId: job.agentId,
      outcome: spent === null ? "job_ended" : "authorised",
    });
    return spent !== null;
  }

  routes.post(
    "/api/satellites/:name/jobs/:sequence/file",
    async (c): Promise<Response> => {
      const authorized = await authorize(c, "download");
      if (authorized instanceof Response) return authorized;
      const { job, token } = authorized;

      const asked = job.args.path;
      const name = satelliteFileNameSchema.safeParse(
        typeof asked === "string" ? basename(asked) : "",
      );
      if (!name.success) return c.json({ error: "bad_source_path" }, 400);

      const declared = Number(c.req.header("content-length") ?? "0");
      if (Number.isFinite(declared) && declared > cap)
        return c.json({ error: "transfer_too_large" }, 413);

      const incoming = c.req.raw.body;
      if (incoming === null) return c.json({ error: "empty_body" }, 400);

      let received = 0;
      const hash = createHash("sha256");
      const counter = new Transform({
        transform(chunk: Buffer, _encoding, done) {
          received += chunk.length;
          if (received > cap) {
            done(new Error("transfer_too_large"));
            return;
          }
          hash.update(chunk);
          done(null, chunk);
        },
      });
      /**
       * UNIT_BOUNDARY_DESCRIPTION: The satellite's body is counted and hashed on
       * its way to the workspace. Both ends of that pipe carry an error handler,
       * so a body or a counter that fails mid-stream fails the transfer and
       * tears the other down, instead of leaving the runtime reading a body that
       * never ends.
       */
      const incomingStream = Readable.fromWeb(
        incoming as Parameters<typeof Readable.fromWeb>[0],
      );
      incomingStream.on("error", (err: Error) => counter.destroy(err));
      counter.on("error", () => incomingStream.destroy());
      incomingStream.pipe(counter);
      const body = counter;

      const destination = destinationOf(job, token.slice(0, 8), name.data);
      const agent = deps.transferFor(job.agentId);
      const staged = await agent
        .stage({
          body,
          path: destination,
          declaredBytes:
            Number.isFinite(declared) && declared > 0 ? declared : undefined,
        })
        .catch(() => ({ ok: false as const, reason: "aborted" as const }));
      if (received > cap) return c.json({ error: "transfer_too_large" }, 413);
      if (!staged.ok) return c.json({ error: "workspace_refused" }, 409);

      if (!(await spend(c.get("user").sub, job, token, "download")))
        return c.json({ error: "no_running_job" }, 409);

      const published = await agent
        .publish({ id: staged.id, path: destination })
        .catch(() => ({ ok: false as const, reason: "refused" as const }));
      if (!published.ok)
        return c.json(
          {
            error:
              published.reason === "exists"
                ? "already_there"
                : "workspace_refused",
          },
          409,
        );

      const written: SatelliteFileWritten = {
        path: published.path,
        size: received,
        sha256: hash.digest("hex"),
      };
      audit("info", {
        direction: "download",
        owner: c.get("user").sub,
        satellite: job.satellite,
        sequence: job.sequence,
        agentId: job.agentId,
        path: written.path,
        bytes: written.size,
        outcome: "written",
      });
      return c.json(written);
    },
  );

  routes.get(
    "/api/satellites/:name/jobs/:sequence/file",
    async (c): Promise<Response> => {
      const authorized = await authorize(c, "upload");
      if (authorized instanceof Response) return authorized;
      const { job, token } = authorized;

      const path = workspacePathOf(job.args);
      if (path === null) return c.json({ error: "bad_workspace_path" }, 400);

      const owner = c.get("user").sub;

      /**
       * UNIT_BOUNDARY_DESCRIPTION: The Job this stream belongs to, as it was at
       * the moment the token was spent. A Satellite's sequence numbers restart
       * when it is registered again, so "the same owner, Satellite and sequence"
       * is not the same Job: a running successor must not keep a predecessor's
       * stream alive, and a Job that ended must not deliver another byte.
       */
      const claim = {
        agentId: job.agentId,
        createdAt: job.createdAt.getTime(),
        startedAt: job.startedAt?.getTime() ?? null,
      };
      const stillOurs = async (): Promise<boolean> => {
        const current = await deps.repo.getJob(
          owner,
          job.satellite,
          job.sequence,
        );
        return (
          current !== null &&
          current.status === "running" &&
          current.agentId === claim.agentId &&
          current.createdAt.getTime() === claim.createdAt &&
          (current.startedAt?.getTime() ?? null) === claim.startedAt
        );
      };

      let sent = 0;
      let stream: Readable | null = null;
      let announced = false;
      const finished = (
        outcome: "delivered" | "job_ended" | "aborted",
      ): void => {
        if (announced) return;
        announced = true;
        clearInterval(watcher);
        audit(outcome === "delivered" ? "info" : "warn", {
          direction: "upload",
          owner,
          satellite: job.satellite,
          sequence: job.sequence,
          agentId: job.agentId,
          path,
          bytes: sent,
          outcome,
        });
      };
      const revoke = (): void => {
        finished("job_ended");
        stream?.destroy(new Error("job ended"));
      };

      const watcher = setInterval(() => {
        if (announced) return;
        void stillOurs()
          .then((ours) => {
            if (!ours) revoke();
          })
          .catch(() => {});
      }, reCheckMs);

      const read = await deps
        .transferFor(job.agentId)
        .read(path)
        .catch(() => ({ ok: false as const, reason: "refused" as const }));
      if (!read.ok) {
        finished("aborted");
        return c.json(
          {
            error:
              read.reason === "not-found"
                ? "not_found"
                : read.reason === "too-large"
                  ? "transfer_too_large"
                  : "workspace_refused",
          },
          read.reason === "not-found"
            ? 404
            : read.reason === "too-large"
              ? 413
              : 409,
        );
      }
      if (read.size > cap) {
        finished("aborted");
        read.stream.destroy();
        return c.json({ error: "transfer_too_large" }, 413);
      }
      if (announced || !(await stillOurs())) {
        finished("aborted");
        read.stream.destroy();
        return c.json({ error: "no_running_job" }, 409);
      }

      if (!(await spend(owner, job, token, "upload"))) {
        finished("aborted");
        read.stream.destroy();
        return c.json({ error: "no_running_job" }, 409);
      }

      /**
       * UNIT_BOUNDARY_DESCRIPTION: The last check before the first byte. The
       * token is spent, so a Job that ended inside that statement, or a tick
       * that revoked while this check was in flight, must still stop the stream
       * — the revocation is read after the await for exactly that reason.
       */
      if (!(await stillOurs()) || announced) {
        finished("aborted");
        read.stream.destroy();
        return c.json({ error: "no_running_job" }, 409);
      }

      stream = read.stream;
      const limiter = new Transform({
        transform(chunk: Buffer, _encoding, done) {
          sent += chunk.length;
          if (sent > cap) {
            finished("aborted");
            done(new Error("transfer_too_large"));
            return;
          }
          done(null, chunk);
        },
      });
      read.stream.pipe(limiter);
      read.stream.on("end", () => finished("delivered"));
      read.stream.on("error", (err: Error) => {
        finished("aborted");
        limiter.destroy(err);
      });
      read.stream.on("close", () => {
        if (read.stream.readableEnded) return;
        finished("aborted");
        limiter.destroy(new Error("the transfer was stopped"));
      });

      return new Response(
        Readable.toWeb(limiter) as ReadableStream<Uint8Array>,
        {
          status: 200,
          headers: {
            "content-type": "application/octet-stream",
            "content-length": String(read.size),
          },
        },
      );
    },
  );

  return routes;
}
