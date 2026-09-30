import type { Hono } from "hono";
import { spawnInvocationRequestSchema } from "api-server-api";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import {
  createDriverOps,
  type DriverOpsDeps,
  type SpawnRequest,
} from "./driver-ops.js";
import { resolveAgent } from "./agent-auth.js";

export interface InvocationEndpointsDeps extends DriverOpsDeps {
  k8s: K8sClient;
}

const REFUSAL_STATUS = { invalid: 400, forbidden: 403, conflict: 409 } as const;

export function mountInvocationRoutes(
  app: Hono,
  deps: InvocationEndpointsDeps,
): void {
  const driverOpsFor = createDriverOps(deps);
  const driverOps = async (driverId: string) => {
    const verified = await resolveAgent(deps.k8s, driverId);
    return verified
      ? driverOpsFor({ id: driverId, owner: verified.owner })
      : null;
  };

  app.post("/api/agents/:id/invocations", async (c) => {
    const ops = await driverOps(c.req.param("id")!);
    if (!ops) return c.json({ error: "not found" }, 404);

    let body: SpawnRequest;
    try {
      body = spawnInvocationRequestSchema.parse(await c.req.json());
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }

    const outcome = await ops.spawn(body);
    if (!outcome.ok) {
      return c.json({ error: outcome.message }, REFUSAL_STATUS[outcome.kind]);
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
