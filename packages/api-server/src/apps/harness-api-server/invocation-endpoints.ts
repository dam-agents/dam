import type { Hono } from "hono";
import {
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
  type SpawnOutcome,
} from "./driver-ops.js";
import { resolveAgent } from "./agent-auth.js";

export interface InvocationEndpointsDeps extends DriverOpsDeps {
  readAgent: (id: string) => Promise<KubeObject | null>;
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
    const ops = await driverOps(c.req.param("id")!);
    if (!ops) return c.json({ error: "not found" }, 404);

    let spawn: () => Promise<SpawnOutcome>;
    try {
      const raw: unknown = await c.req.json();
      if (hasOversizedArray(raw)) {
        return c.json({ error: OVERSIZED_ARRAY_MESSAGE }, 400);
      }
      spawn = spawnFor(ops, raw);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }

    const outcome = await spawn();
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

  app.get("/api/agents/:id/budget", async (c) => {
    const ops = await driverOps(c.req.param("id")!);
    if (!ops) return c.json({ error: "not found" }, 404);
    return c.json(await ops.budget());
  });
}

function spawnFor(ops: DriverOps, raw: unknown): () => Promise<SpawnOutcome> {
  const fields =
    typeof raw === "object" && raw !== null ? Object.keys(raw) : [];
  if (!fields.includes("script")) {
    const body = spawnInvocationRequestSchema.parse(raw);
    return () => ops.spawn(body);
  }
  const conflicting = ["prompt", "schema", "harnessConfig"].filter((f) =>
    fields.includes(f),
  );
  if (conflicting.length > 0)
    throw new Error(
      `a script spawn takes no ${conflicting.join(", ")}: pass a script or a prompt`,
    );
  const body = spawnScriptInvocationRequestSchema.parse(raw);
  return () => ops.spawnScript(body);
}
