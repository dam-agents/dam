import type { Hono } from "hono";
import { z } from "zod";
import {
  appendEventsRequestSchema,
  planRegisterRequestSchema,
  finishRequestSchema,
  type ExperimentsService,
} from "api-server-api";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import {
  CustomDataTooLargeError,
  ExperimentClosedError,
  ScriptContentRequiredError,
  UnknownExperimentError,
} from "../../modules/experiments/index.js";
import { resolveAgent } from "./agent-auth.js";

export interface ExperimentEndpointsDeps {
  k8s: K8sClient;
  experimentsServiceFor: (owner: string) => ExperimentsService;
}

function mapError(c: {
  json: (body: unknown, status: 400 | 404 | 409) => Response;
}): (err: unknown) => Response {
  return (err) => {
    if (err instanceof UnknownExperimentError) {
      return c.json({ error: err.message }, 404);
    }
    if (err instanceof ExperimentClosedError) {
      return c.json({ error: err.message }, 409);
    }
    if (
      err instanceof ScriptContentRequiredError ||
      err instanceof CustomDataTooLargeError ||
      err instanceof z.ZodError
    ) {
      return c.json({ error: (err as Error).message }, 400);
    }
    throw err;
  };
}

export function mountExperimentRoutes(
  app: Hono,
  deps: ExperimentEndpointsDeps,
): void {
  app.post("/api/agents/:id/experiments/plan", async (c) => {
    const driverId = c.req.param("id")!;
    const verified = await resolveAgent(deps.k8s, driverId);
    if (!verified) return c.json({ error: "not found" }, 404);

    let body: z.infer<typeof planRegisterRequestSchema>;
    try {
      body = planRegisterRequestSchema.parse(await c.req.json());
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }

    const { experimentId } = await deps
      .experimentsServiceFor(verified.owner)
      .planRegister(driverId, body);
    return c.json({ experimentId }, 201);
  });

  app.post("/api/agents/:id/experiments/:experimentId/events", async (c) => {
    const driverId = c.req.param("id")!;
    const experimentId = c.req.param("experimentId")!;
    const verified = await resolveAgent(deps.k8s, driverId);
    if (!verified) return c.json({ error: "not found" }, 404);

    try {
      const body = appendEventsRequestSchema.parse(await c.req.json());
      const result = await deps
        .experimentsServiceFor(verified.owner)
        .appendEvents(driverId, experimentId, body.events);
      return c.json(result);
    } catch (err) {
      return mapError(c)(err);
    }
  });

  app.post("/api/agents/:id/experiments/:experimentId/finish", async (c) => {
    const driverId = c.req.param("id")!;
    const experimentId = c.req.param("experimentId")!;
    const verified = await resolveAgent(deps.k8s, driverId);
    if (!verified) return c.json({ error: "not found" }, 404);

    try {
      const body = finishRequestSchema.parse(await c.req.json());
      await deps
        .experimentsServiceFor(verified.owner)
        .finish(driverId, experimentId, body);
      return c.json({ ok: true });
    } catch (err) {
      return mapError(c)(err);
    }
  });
}
