import type { Hono } from "hono";
import { z } from "zod";
import {
  childEgressRuleSchema,
  hasOversizedArray,
  invocationOutputStreamSchema,
  OVERSIZED_ARRAY_MESSAGE,
  spawnInvocationRequestSchema,
  spawnScriptInvocationRequestSchema,
} from "api-server-api";
import type { KubeObject } from "../../modules/agents/infrastructure/k8s.js";
import {
  createDriverOps,
  type DriverOps,
  type DriverOpsDeps,
  stopReasonSchema,
  type SpawnOutcome,
} from "./driver-ops.js";
import { resolveAgent } from "./agent-auth.js";
import { SESSION_REF_HEADER } from "agent-runtime-api";
import {
  SESSION_ID_HEADER,
  sessionNamedBy,
  type SessionNamed,
} from "./spawning-session.js";

export interface InvocationEndpointsDeps extends DriverOpsDeps {
  readAgent: (id: string) => Promise<KubeObject | null>;
  spawningSession: (
    driverId: string,
    named: SessionNamed,
  ) => Promise<string | null>;
}

const REFUSAL_STATUS = {
  invalid: 400,
  forbidden: 403,
  conflict: 409,
  spend_limit_reached: 403,
} as const;

export function mountInvocationRoutes(
  app: Hono,
  deps: InvocationEndpointsDeps,
): void {
  const driverOpsFor = createDriverOps(deps);
  const driverOps = async (driverId: string) => {
    const verified = await resolveAgent(deps.readAgent, driverId);
    return verified
      ? driverOpsFor({ id: driverId, owner: verified.owner })
      : null;
  };

  app.post("/api/agents/:id/invocations", async (c) => {
    const driverId = c.req.param("id")!;
    const ops = await driverOps(driverId);
    if (!ops) return c.json({ error: "not found" }, 404);

    let spawn: (from: SpawnFrom) => Promise<SpawnOutcome>;
    try {
      const raw: unknown = await c.req.json();
      if (hasOversizedArray(raw)) {
        return c.json({ error: OVERSIZED_ARRAY_MESSAGE }, 400);
      }
      spawn = spawnFor(ops, raw);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }

    const named = sessionNamedBy(
      c.req.header(SESSION_REF_HEADER),
      c.req.header(SESSION_ID_HEADER),
    );
    const driverSessionId = named
      ? await deps.spawningSession(driverId, named)
      : null;
    const outcome = await spawn({ origin: "script", driverSessionId });
    if (!outcome.ok) {
      return c.json(
        { error: outcome.message, kind: outcome.kind },
        REFUSAL_STATUS[outcome.kind],
      );
    }
    return c.json({ id: outcome.id }, 201);
  });

  app.get("/api/agents/:id/invocations/:invocationId", async (c) => {
    const ops = await driverOps(c.req.param("id")!);
    if (!ops) return c.json({ error: "not found" }, 404);

    const view = await ops.get(c.req.param("invocationId")!);
    if (!view) return c.json({ error: "not found" }, 404);
    return c.json(view);
  });

  app.get(
    "/api/agents/:id/invocations/:invocationId/output/:stream",
    async (c) => {
      const ops = await driverOps(c.req.param("id")!);
      if (!ops) return c.json({ error: "not found" }, 404);
      const stream = invocationOutputStreamSchema.safeParse(
        c.req.param("stream"),
      );
      if (!stream.success) return c.json({ error: "not found" }, 404);

      const link = await ops.outputLink(
        c.req.param("invocationId")!,
        stream.data,
      );
      if (!link) return c.json({ error: "no such output" }, 404);
      return c.json(link);
    },
  );

  app.post(
    "/api/agents/:id/invocations/:invocationId/output/:stream/ack",
    async (c) => {
      const ops = await driverOps(c.req.param("id")!);
      if (!ops) return c.json({ error: "not found" }, 404);
      const stream = invocationOutputStreamSchema.safeParse(
        c.req.param("stream"),
      );
      if (!stream.success) return c.json({ error: "not found" }, 404);

      const acked = await ops.ackOutput(
        c.req.param("invocationId")!,
        stream.data,
      );
      if (!acked) return c.json({ error: "not found" }, 404);
      return c.body(null, 204);
    },
  );

  // UNIT_BOUNDARY_DESCRIPTION: what a driver does with a sub-agent after its spawn: start a run in a clean slate or kept one (answered with the run's id, which reads its result, and the session it continues), keep it longer, wake it, or set an open one's egress rules. Each answers or refuses with its reason, as a spawn refusal does.
  const refused = (message: string) => ({ error: message, kind: "invalid" });

  app.post("/api/agents/:id/invocations/:invocationId/run", async (c) => {
    const ops = await driverOps(c.req.param("id")!);
    if (!ops) return c.json({ error: "not found" }, 404);
    const parsed = runRequestSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) return c.json(refused(parsed.error.message), 400);
    const { ttlMs, ...run } = parsed.data;
    const outcome = await ops.runSubagent(
      c.req.param("invocationId")!,
      "script" in run && run.script !== undefined
        ? { script: run.script }
        : {
            prompt: run.prompt!,
            schema: run.schema,
            ...(run.model ? { model: run.model } : {}),
            ...(run.session ? { session: run.session } : {}),
          },
      { ...(ttlMs !== undefined ? { ttlMs } : {}), origin: "script" },
    );
    return outcome.ok
      ? c.json(
          {
            run: outcome.run,
            ...(outcome.session && { session: outcome.session }),
          },
          201,
        )
      : c.json(refused(outcome.message), REFUSAL_STATUS[outcome.kind]);
  });

  app.post("/api/agents/:id/invocations/:invocationId/keep", async (c) => {
    const ops = await driverOps(c.req.param("id")!);
    if (!ops) return c.json({ error: "not found" }, 404);
    const parsed = keepRequestSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) return c.json(refused(parsed.error.message), 400);
    const outcome = await ops.extendKeep(
      c.req.param("invocationId")!,
      parsed.data,
    );
    return outcome.ok
      ? c.json({
          keepUntil: outcome.keepUntil,
          ...(outcome.idleTimeoutMin !== undefined && {
            idleTimeoutMin: outcome.idleTimeoutMin,
          }),
        })
      : c.json(refused(outcome.message), 409);
  });

  app.post("/api/agents/:id/invocations/:invocationId/wake", async (c) => {
    const ops = await driverOps(c.req.param("id")!);
    if (!ops) return c.json({ error: "not found" }, 404);
    const outcome = await ops.wakeSubagent(c.req.param("invocationId")!);
    return outcome.ok
      ? c.body(null, 204)
      : c.json(refused(outcome.message), 409);
  });

  app.post("/api/agents/:id/invocations/:invocationId/stop", async (c) => {
    const ops = await driverOps(c.req.param("id")!);
    if (!ops) return c.json({ error: "not found" }, 404);
    const parsed = stopRequestSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!parsed.success) return c.json(refused(parsed.error.message), 400);
    const outcome = await ops.stopSubagent(
      c.req.param("invocationId")!,
      parsed.data.reason,
    );
    return outcome.ok
      ? c.json({ stopped: outcome.stopped })
      : c.json(refused(outcome.message), 409);
  });

  app.post("/api/agents/:id/invocations/:invocationId/egress", async (c) => {
    const ops = await driverOps(c.req.param("id")!);
    if (!ops) return c.json({ error: "not found" }, 404);
    const parsed = egressRequestSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) return c.json(refused(parsed.error.message), 400);
    const outcome = await ops.setChildEgress(
      c.req.param("invocationId")!,
      parsed.data.rules,
    );
    return outcome.ok
      ? c.body(null, 204)
      : c.json(refused(outcome.message), 409);
  });

  app.get("/api/agents/:id/connections", async (c) => {
    const ops = await driverOps(c.req.param("id")!);
    if (!ops) return c.json({ error: "not found" }, 404);
    return c.json({ connections: await ops.connections() });
  });

  app.get("/api/agents/:id/images", async (c) => {
    const ops = await driverOps(c.req.param("id")!);
    if (!ops) return c.json({ error: "not found" }, 404);
    return c.json({ images: await ops.images() });
  });
}

const runRequestSchema = z
  .object({
    prompt: z.string().min(1).optional(),
    schema: z.unknown().optional(),
    model: z.string().min(1).optional(),
    script: z.string().min(1).optional(),
    session: z.string().min(1).optional(),
    ttlMs: z.number().int().positive().optional(),
  })
  .refine((r) => (r.prompt === undefined) !== (r.script === undefined), {
    message: "pass a prompt (with schema) or a script",
  })
  .refine((r) => r.prompt === undefined || r.schema !== undefined, {
    message: "a prompt needs a schema: the JSON Schema its result must match",
  })
  .refine((r) => r.script === undefined || r.session === undefined, {
    message: "a script runs in no session; drop session",
  });

const keepRequestSchema = z
  .object({
    keepForMs: z.number().int().min(60_000).optional(),
    idleTimeoutMin: z.number().int().min(1).optional(),
  })
  .refine((r) => r.keepForMs !== undefined || r.idleTimeoutMin !== undefined, {
    message: "pass keepForMs, idleTimeoutMin or both",
  });

const stopRequestSchema = z.object({
  reason: stopReasonSchema.optional(),
});

const egressRequestSchema = z.object({
  rules: z.array(childEgressRuleSchema).max(200),
});

type SpawnFrom = Parameters<DriverOps["spawn"]>[1];

function spawnFor(
  ops: DriverOps,
  raw: unknown,
): (from: SpawnFrom) => Promise<SpawnOutcome> {
  const fields =
    typeof raw === "object" && raw !== null ? Object.keys(raw) : [];
  if (!fields.includes("script") && !fields.includes("prompt")) {
    if (fields.includes("schema") || fields.includes("harnessConfig"))
      throw new Error(
        "a clean slate takes no schema or harnessConfig: pass them with its run",
      );
    const { script: _placeholder, ...body } =
      spawnScriptInvocationRequestSchema.parse({
        ...(raw as Record<string, unknown>),
        script: "true",
      });
    return (from) => ops.spawnIdle(body, from);
  }
  if (!fields.includes("script")) {
    const body = spawnInvocationRequestSchema.parse(raw);
    return (from) => ops.spawn(body, from);
  }
  const conflicting = ["prompt", "schema", "harnessConfig"].filter((f) =>
    fields.includes(f),
  );
  if (conflicting.length > 0)
    throw new Error(
      `a script spawn takes no ${conflicting.join(", ")}: pass a script or a prompt`,
    );
  const body = spawnScriptInvocationRequestSchema.parse(raw);
  return (from) => ops.spawnScript(body, from);
}
