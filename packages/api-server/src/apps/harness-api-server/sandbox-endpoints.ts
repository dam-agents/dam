import type { Hono } from "hono";
import { z } from "zod";
import type { ConnectionsService, TemplatesService } from "api-server-api";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import {
  AttenuationError,
  InvalidSchemaError,
  MIN_SANDBOX_TTL_MS,
  MAX_SANDBOX_TTL_MS,
  type SandboxesService,
} from "../../modules/sandboxes/index.js";
import { securityLog } from "../../core/security-log.js";
import { resolveAgent } from "./agent-auth.js";

export interface SandboxEndpointsDeps {
  k8s: K8sClient;
  sandboxesServiceFor: (owner: string) => SandboxesService;
  connectionsServiceFor: (owner: string) => ConnectionsService;
  templates: TemplatesService;
}

const spawnBody = z
  .object({
    image: z.string().min(1).optional(),
    templateId: z.string().min(1).optional(),
    connections: z.array(z.string().min(1)).optional(),
    prompt: z.string().min(1),
    // The result JSON Schema — arbitrary JSON, validated structurally by ajv
    // when the sandbox reports (a malformed schema is rejected at spawn).
    schema: z.unknown(),
    // Optional liveness deadline for this node, in ms. Bounded server-side; a
    // shorter value fails a wedged/misconfigured node fast, a longer one lets a
    // heavy node run past the default hour.
    ttlMs: z
      .number()
      .int()
      .min(MIN_SANDBOX_TTL_MS)
      .max(MAX_SANDBOX_TTL_MS)
      .optional(),
    // Optional resource limits. A heavy Make (clone + install + build) OOM-kills
    // at the template's small default memory, so let the driver raise it. Same
    // grammar and floors as the agent size knob.
    memory: z
      .string()
      .regex(/^\d+(Mi|Gi)$/, "memory must look like '512Mi' or '4Gi'")
      .optional(),
    cpu: z
      .string()
      .regex(/^\d+(\.\d+)?m?$/, "cpu must look like '2', '0.5' or '500m'")
      .optional(),
  })
  .refine((d) => d.image !== undefined || d.templateId !== undefined, {
    message: "either image or templateId is required",
  });

/** Mounts the driver-facing sandbox primitive on the harness surface. Every
 *  route is scoped to the driver's identity — the `:id` the waypoint already
 *  authenticated. Create-then-poll: POST returns an id, GET reports status +
 *  the schema-validated result. */
export function mountSandboxRoutes(
  app: Hono,
  deps: SandboxEndpointsDeps,
): void {
  // Spawn a sandbox as the driver (:id). The driver's own connection grants are
  // the attenuation ceiling for the requested subset.
  app.post("/api/agents/:id/sandboxes", async (c) => {
    const driverId = c.req.param("id")!;
    const verified = await resolveAgent(deps.k8s, driverId);
    if (!verified) return c.json({ error: "not found" }, 404);

    let body: z.infer<typeof spawnBody>;
    try {
      body = spawnBody.parse(await c.req.json());
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }

    const connections = body.connections ?? [];
    const size =
      body.cpu !== undefined || body.memory !== undefined
        ? {
            ...(body.cpu !== undefined ? { cpu: body.cpu } : {}),
            ...(body.memory !== undefined ? { memory: body.memory } : {}),
          }
        : undefined;
    const conns = deps.connectionsServiceFor(verified.owner);
    const granted = await conns.getAgentConnections(driverId);
    const driverGrantIds = granted.connections.map((g) => g.connectionId);

    try {
      const { id } = await deps.sandboxesServiceFor(verified.owner).spawn({
        driverAgentId: driverId,
        driverGrantIds,
        ...(body.image ? { image: body.image } : {}),
        ...(body.templateId ? { templateId: body.templateId } : {}),
        connections,
        prompt: body.prompt,
        schema: body.schema,
        ...(body.ttlMs !== undefined ? { ttlMs: body.ttlMs } : {}),
        ...(size ? { size } : {}),
      });
      return c.json({ id }, 201);
    } catch (err) {
      if (err instanceof AttenuationError) {
        securityLog("warn", "sandbox.attenuation_denied", {
          category: "authz",
          actor: verified.owner,
          actorKind: "agent",
          surface: "mcp",
          decision: "deny",
          agentId: driverId,
          reason: "connection-not-granted-to-driver",
          detail: { offending: err.offending },
        });
        return c.json({ error: err.message }, 403);
      }
      if (err instanceof InvalidSchemaError) {
        return c.json({ error: err.message }, 400);
      }
      throw err;
    }
  });

  // Poll a sandbox the driver spawned.
  app.get("/api/agents/:id/sandboxes/:sandboxId", async (c) => {
    const driverId = c.req.param("id")!;
    const sandboxId = c.req.param("sandboxId")!;
    const verified = await resolveAgent(deps.k8s, driverId);
    if (!verified) return c.json({ error: "not found" }, 404);

    const view = await deps
      .sandboxesServiceFor(verified.owner)
      .get(sandboxId, driverId);
    if (!view) return c.json({ error: "not found" }, 404);
    return c.json(view);
  });

  // The driver's own connection grants — the set it may pass to a sandbox.
  app.get("/api/agents/:id/connections", async (c) => {
    const driverId = c.req.param("id")!;
    const verified = await resolveAgent(deps.k8s, driverId);
    if (!verified) return c.json({ error: "not found" }, 404);

    const conns = deps.connectionsServiceFor(verified.owner);
    const [all, granted] = await Promise.all([
      conns.listConnections(),
      conns.getAgentConnections(driverId),
    ]);
    const grantedIds = new Set(granted.connections.map((g) => g.connectionId));
    const connections = all
      .filter((cn) => grantedIds.has(cn.id))
      .map((cn) => ({ id: cn.id, name: cn.name, hosts: cn.hosts }));
    return c.json({ connections });
  });

  // The image catalog a sandbox may run.
  app.get("/api/agents/:id/images", async (c) => {
    const driverId = c.req.param("id")!;
    const verified = await resolveAgent(deps.k8s, driverId);
    if (!verified) return c.json({ error: "not found" }, 404);

    const templates = await deps.templates.list();
    const images = templates.map((t) => ({
      id: t.id,
      name: t.name,
      image: t.spec.image,
      description: t.spec.description,
    }));
    return c.json({ images });
  });
}
