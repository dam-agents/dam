import type { z } from "zod";
import {
  PROVIDERS,
  providerTypeForTemplateId,
  type BudgetsService,
  type ConnectionsService,
  type HarnessCatalog,
  type InvocationView,
  type ProviderPresetType,
  type spawnInvocationRequestSchema,
  type TemplatesService,
} from "api-server-api";
import {
  concreteResources,
  type DefaultResourceLimits,
} from "../../modules/agents/index.js";
import { SizeNeverFitsError } from "../../modules/budgets/index.js";
import {
  AttenuationError,
  inheritProvider,
  InvalidSchemaError,
  ModelNameError,
  ProviderMismatchError,
  SpendLimitReachedError,
  UnresolvableDriverError,
  type DriverProvider,
  type InvocationOrigin,
  type InvocationsService,
  type SpawnInput,
} from "../../modules/invocations/index.js";
import { securityLog } from "../../core/security-log.js";
import { DEFAULT_TEMPLATE_ID } from "../../modules/templates/index.js";

export type SpawnRequest = z.infer<typeof spawnInvocationRequestSchema>;

export type SpawnOutcome =
  | { ok: true; id: string }
  | {
      ok: false;
      kind: "invalid" | "forbidden" | "conflict" | "spend_limit_reached";
      message: string;
    };

export interface DriverOpsDeps {
  agents: {
    get(id: string): Promise<{
      templateId?: string;
      spec: { image: string; harness?: string };
    } | null>;
  };
  invocationsServiceFor: (owner: string) => InvocationsService;
  connectionsServiceFor: (owner: string) => ConnectionsService;
  templates: TemplatesService;
  harnesses: HarnessCatalog;
  budgetsFor: (owner: string) => BudgetsService;
  defaultLimits: DefaultResourceLimits;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: What a Driver can do with Invocations, whichever
 * surface it came through: the driver SDK's HTTP routes and the sub-agent MCP
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
    async spawn(
      body: SpawnRequest,
      from: { origin: InvocationOrigin; driverSessionId?: string | null } = {
        origin: "script",
      },
    ): Promise<SpawnOutcome> {
      const target: SpawnInput["target"] = body.image
        ? { image: body.image }
        : {};
      const carried = body.harness
        ? deps.harnesses.harnesses.find((h) => h.name === body.harness)
        : undefined;
      if (carried) {
        if (!body.image) target.templateId = DEFAULT_TEMPLATE_ID;
        target.harness = carried.name;
        if (carried.providers) target.runsOn = carried.providers;
      } else if (body.harness) {
        const templates = await deps.templates.list();
        const matches = templates.filter(
          (t) => t.spec.harness === body.harness,
        );
        if (matches.length !== 1) {
          const available = [
            ...new Set([
              ...deps.harnesses.harnesses.map((h) => h.name),
              ...templates.flatMap((t) => t.spec.harness ?? []),
            ]),
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
      const { driverProviders, attachableProviders } = providersOf(
        owned,
        grantSet,
      );

      try {
        const { id } = await invocations.spawn({
          driverAgentId: driverId,
          driverGrantIds,
          driverProviders,
          attachableProviders,
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
          ...(body.harnessConfig ? { harnessConfig: body.harnessConfig } : {}),
          origin: from.origin,
          driverSessionId: from.driverSessionId ?? null,
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
          err instanceof ModelNameError ||
          err instanceof ProviderMismatchError
        ) {
          return { ok: false, kind: "invalid", message: err.message };
        }
        if (err instanceof UnresolvableDriverError) {
          return { ok: false, kind: "conflict", message: err.message };
        }
        if (err instanceof SpendLimitReachedError) {
          return {
            ok: false,
            kind: "spend_limit_reached",
            message: err.message,
          };
        }
        throw err;
      }
    },

    get: (invocationId: string): Promise<InvocationView | null> =>
      invocations.get(invocationId, driverId),

    async harness(): Promise<string | null> {
      const [agent, templates] = await Promise.all([
        deps.agents.get(driverId),
        deps.templates.list(),
      ]);
      if (!agent) return null;
      if (agent.spec.harness) return agent.spec.harness;
      const template =
        templates.find((t) => t.id === agent.templateId) ??
        templates.find((t) => t.spec.image === agent.spec.image);
      return template?.spec.harness ?? null;
    },

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
      const [templates, granted, owned] = await Promise.all([
        deps.templates.list(),
        conns.getAgentConnections(driverId),
        conns.listConnections(),
      ]);
      const { driverProviders } = providersOf(
        owned,
        new Set(granted.connections.map((g) => g.connectionId)),
      );
      const runsOn = (
        harness: string,
        providers: ProviderPresetType[] | undefined,
      ) => {
        const inherited = inheritProvider(driverProviders, {
          runsOn: providers,
          harness,
        });
        if (inherited.kind === "inherited") {
          const type = driverProviders.find((p) => p.id === inherited.id)!.type;
          return { provider: PROVIDERS[type].displayName };
        }
        return {
          unavailable:
            inherited.kind === "incompatible"
              ? `needs one of ${(providers ?? []).map((p) => PROVIDERS[p].displayName).join(", ")}, which this agent does not hold`
              : "this agent holds no model provider",
        };
      };
      return templates.flatMap((t) => {
        const size = concreteResources(
          t.spec.resources,
          undefined,
          deps.defaultLimits,
        ).limits;
        return t.id === DEFAULT_TEMPLATE_ID
          ? deps.harnesses.harnesses.map((h) => ({
              id: t.id,
              name: h.displayName,
              image: t.spec.image,
              description: h.description,
              harness: h.name,
              size,
              ...runsOn(h.name, h.providers),
            }))
          : [
              {
                id: t.id,
                name: t.name,
                image: t.spec.image,
                description: t.spec.description,
                ...(t.spec.harness ? { harness: t.spec.harness } : {}),
                size,
                ...(t.spec.harness
                  ? runsOn(t.spec.harness, t.spec.providers)
                  : {}),
              },
            ];
      });
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

/**
 * UNIT_BOUNDARY_DESCRIPTION: the provider Connections the driver holds,
 * which a sub-agent inherits from, and the ones its owner holds but has not
 * attached to it, which a refused spawn names as the fix.
 */
function providersOf(
  owned: readonly { id: string; templateId: string }[],
  granted: ReadonlySet<string>,
): {
  driverProviders: DriverProvider[];
  attachableProviders: ProviderPresetType[];
} {
  const typed = owned.flatMap((cn) => {
    const type = providerTypeForTemplateId(cn.templateId);
    return type ? [{ id: cn.id, type }] : [];
  });
  return {
    driverProviders: typed.filter((p) => granted.has(p.id)),
    attachableProviders: typed
      .filter((p) => !granted.has(p.id))
      .map((p) => p.type),
  };
}
