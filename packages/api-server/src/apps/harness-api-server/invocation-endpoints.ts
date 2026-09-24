import type { Hono } from "hono";
import type { z } from "zod";
import {
  providerTypeForTemplateId,
  spawnInvocationRequestSchema,
  type BudgetsService,
  type ConnectionsService,
  type TemplatesService,
} from "api-server-api";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import {
  concreteResources,
  type DefaultResourceLimits,
} from "../../modules/agents/index.js";
import { SizeNeverFitsError } from "../../modules/budgets/index.js";
import {
  AttenuationError,
  ExperimentNotRunningError,
  InvalidSchemaError,
  ProviderMismatchError,
  UnresolvableDriverError,
  type InvocationsService,
  type SpawnInput,
} from "../../modules/invocations/index.js";
import { securityLog } from "../../core/security-log.js";
import { resolveAgent } from "./agent-auth.js";

export interface InvocationEndpointsDeps {
  k8s: K8sClient;
  invocationsServiceFor: (owner: string) => InvocationsService;
  connectionsServiceFor: (owner: string) => ConnectionsService;
  templates: TemplatesService;
  budgetsFor: (owner: string) => BudgetsService;
  defaultLimits: DefaultResourceLimits;
}

export function mountInvocationRoutes(
  app: Hono,
  deps: InvocationEndpointsDeps,
): void {
  app.post("/api/agents/:id/invocations", async (c) => {
    const driverId = c.req.param("id")!;
    const verified = await resolveAgent(deps.k8s, driverId);
    if (!verified) return c.json({ error: "not found" }, 404);

    let body: z.infer<typeof spawnInvocationRequestSchema>;
    try {
      body = spawnInvocationRequestSchema.parse(await c.req.json());
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }

    const target: SpawnInput["target"] = body.image
      ? { image: body.image }
      : {};
    if (body.harness) {
      const templates = await deps.templates.list();
      const matches = templates.filter((t) => t.spec.harness === body.harness);
      if (matches.length !== 1) {
        const available = [
          ...new Set(templates.flatMap((t) => t.spec.harness ?? [])),
        ]
          .sort()
          .join(", ");
        const problem =
          matches.length === 0
            ? `no harness "${body.harness}" on this install`
            : `the "${body.harness}" harness has several templates on this install`;
        return c.json({ error: `${problem} — available: ${available}` }, 400);
      }
      const [template] = matches;
      if (!body.image) target.templateId = template!.id;
      if (template!.spec.providers) target.runsOn = template!.spec.providers;
    }

    const connections = body.connections ?? [];
    const resources =
      body.resources ??
      (body.cpu !== undefined || body.memory !== undefined
        ? {
            ...(body.cpu !== undefined ? { cpu: body.cpu } : {}),
            ...(body.memory !== undefined ? { memory: body.memory } : {}),
          }
        : undefined);
    const conns = deps.connectionsServiceFor(verified.owner);
    const [granted, owned] = await Promise.all([
      conns.getAgentConnections(driverId),
      conns.listConnections(),
    ]);
    const driverGrantIds = granted.connections.map((g) => g.connectionId);
    const grantSet = new Set(driverGrantIds);
    const driverProviders = owned.flatMap((cn) => {
      const type = grantSet.has(cn.id)
        ? providerTypeForTemplateId(cn.templateId)
        : null;
      return type ? [{ id: cn.id, type }] : [];
    });

    try {
      const { id } = await deps.invocationsServiceFor(verified.owner).spawn({
        driverAgentId: driverId,
        driverGrantIds,
        driverProviders,
        target,
        setup: {
          ...(body.seed ? { seed: body.seed } : {}),
          ...(body.install ? { install: body.install } : {}),
          ...(body.backend ? { backend: body.backend } : {}),
          ...(resources ? { resources } : {}),
          env: body.env,
          skills: body.skills,
        },
        connections,
        prompt: body.prompt,
        schema: body.schema,
        ...(body.ttlMs !== undefined ? { ttlMs: body.ttlMs } : {}),
        ...(body.experimentSpanId !== undefined
          ? { experimentSpanId: body.experimentSpanId }
          : {}),
      });
      return c.json({ id }, 201);
    } catch (err) {
      if (err instanceof AttenuationError) {
        securityLog("warn", "invocation.attenuation_denied", {
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
      if (err instanceof ProviderMismatchError) {
        return c.json({ error: err.message }, 400);
      }
      if (err instanceof SizeNeverFitsError) {
        return c.json({ error: err.message }, 400);
      }
      if (err instanceof ExperimentNotRunningError) {
        return c.json({ error: err.message }, 409);
      }
      if (err instanceof UnresolvableDriverError) {
        return c.json({ error: err.message }, 409);
      }
      throw err;
    }
  });

  app.get("/api/agents/:id/invocations/:invocationId", async (c) => {
    const driverId = c.req.param("id")!;
    const invocationId = c.req.param("invocationId")!;
    const verified = await resolveAgent(deps.k8s, driverId);
    if (!verified) return c.json({ error: "not found" }, 404);

    const view = await deps
      .invocationsServiceFor(verified.owner)
      .get(invocationId, driverId);
    if (!view) return c.json({ error: "not found" }, 404);
    return c.json(view);
  });

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
      ...(t.spec.harness ? { harness: t.spec.harness } : {}),
      size: concreteResources(t.spec.resources, undefined, deps.defaultLimits)
        .limits,
    }));
    return c.json({ images });
  });

  app.get("/api/agents/:id/budget", async (c) => {
    const driverId = c.req.param("id")!;
    const verified = await resolveAgent(deps.k8s, driverId);
    if (!verified) return c.json({ error: "not found" }, 404);

    const reserved = await deps.budgetsFor(verified.owner).reserved();
    return c.json({
      cpu: reserved.cpu,
      memory: reserved.memory,
      defaultWorkerSize: {
        cpu: deps.defaultLimits.cpu,
        memory: deps.defaultLimits.memory,
      },
    });
  });
}
