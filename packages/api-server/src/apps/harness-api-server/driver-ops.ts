import type { z } from "zod";
import {
  providerTypeForTemplateId,
  type BudgetsService,
  type ConnectionsService,
  type InvocationView,
  type spawnInvocationRequestSchema,
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
  InvalidSchemaError,
  ProviderMismatchError,
  UnresolvableDriverError,
  type InvocationsService,
  type SpawnInput,
} from "../../modules/invocations/index.js";
import { securityLog } from "../../core/security-log.js";

export type SpawnRequest = z.infer<typeof spawnInvocationRequestSchema>;

export type SpawnOutcome =
  | { ok: true; id: string }
  | { ok: false; kind: "invalid" | "forbidden" | "conflict"; message: string };

export interface DriverOpsDeps {
  invocationsServiceFor: (owner: string) => InvocationsService;
  connectionsServiceFor: (owner: string) => ConnectionsService;
  templates: TemplatesService;
  budgetsFor: (owner: string) => BudgetsService;
  defaultLimits: DefaultResourceLimits;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: What a Driver can do with Invocations, whichever
 * surface it came through: the driver SDK's HTTP routes and the invocation MCP
 * tools both call these, so a spawn means the same on either.
 */
export type DriverOps = ReturnType<typeof driverOps>;

export type DriverOpsFor = (driver: { id: string; owner: string }) => DriverOps;

export function createDriverOps(deps: DriverOpsDeps): DriverOpsFor {
  return (driver) => driverOps(deps, driver);
}

function driverOps(
  deps: DriverOpsDeps,
  { id: driverId, owner }: { id: string; owner: string },
) {
  const invocations = deps.invocationsServiceFor(owner);
  const conns = deps.connectionsServiceFor(owner);

  return {
    async spawn(body: SpawnRequest): Promise<SpawnOutcome> {
      const target: SpawnInput["target"] = body.image
        ? { image: body.image }
        : {};
      if (body.harness) {
        const templates = await deps.templates.list();
        const matches = templates.filter(
          (t) => t.spec.harness === body.harness,
        );
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
          return {
            ok: false,
            kind: "invalid",
            message: `${problem} — available: ${available}`,
          };
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
        const { id } = await invocations.spawn({
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
          ...(body.label !== undefined ? { label: body.label } : {}),
          ...(body.ttlMs !== undefined ? { ttlMs: body.ttlMs } : {}),
        });
        return { ok: true, id };
      } catch (err) {
        if (err instanceof AttenuationError) {
          securityLog("warn", "invocation.attenuation_denied", {
            category: "authz",
            actor: owner,
            actorKind: "agent",
            surface: "mcp",
            decision: "deny",
            agentId: driverId,
            reason: "connection-not-granted-to-driver",
            detail: { offending: err.offending },
          });
          return { ok: false, kind: "forbidden", message: err.message };
        }
        if (
          err instanceof InvalidSchemaError ||
          err instanceof SizeNeverFitsError ||
          err instanceof ProviderMismatchError
        ) {
          return { ok: false, kind: "invalid", message: err.message };
        }
        if (err instanceof UnresolvableDriverError) {
          return { ok: false, kind: "conflict", message: err.message };
        }
        throw err;
      }
    },

    get: (invocationId: string): Promise<InvocationView | null> =>
      invocations.get(invocationId, driverId),

    async connections() {
      const [all, granted] = await Promise.all([
        conns.listConnections(),
        conns.getAgentConnections(driverId),
      ]);
      const grantedIds = new Set(
        granted.connections.map((g) => g.connectionId),
      );
      return all
        .filter((cn) => grantedIds.has(cn.id))
        .map((cn) => ({ id: cn.id, name: cn.name, hosts: cn.hosts }));
    },

    async images() {
      const templates = await deps.templates.list();
      return templates.map((t) => ({
        id: t.id,
        name: t.name,
        image: t.spec.image,
        description: t.spec.description,
        ...(t.spec.harness ? { harness: t.spec.harness } : {}),
        size: concreteResources(t.spec.resources, undefined, deps.defaultLimits)
          .limits,
      }));
    },

    async budget() {
      const reserved = await deps.budgetsFor(owner).reserved();
      return {
        cpu: reserved.cpu,
        memory: reserved.memory,
        defaultWorkerSize: {
          cpu: deps.defaultLimits.cpu,
          memory: deps.defaultLimits.memory,
        },
      };
    },
  };
}
