import { match } from "ts-pattern";
import type { z } from "zod";
import {
  isQualifiedModel,
  PROVIDERS,
  providerTypeForTemplateId,
  type BudgetsService,
  type ConnectionsService,
  type HarnessCatalog,
  type InvocationView,
  type ProviderPresetType,
  type InvocationOutputLink,
  type InvocationOutputStream,
  type spawnInvocationRequestSchema,
  type spawnScriptInvocationRequestSchema,
  type TemplatesService,
} from "api-server-api";
import {
  concreteResources,
  type DefaultResourceLimits,
} from "../../modules/agents/index.js";
import { SizeNeverFitsError } from "../../modules/budgets/index.js";
import {
  AttenuationError,
  NoSpawnModelError,
  InvalidSchemaError,
  ModelNameError,
  NoOutputStoreError,
  ProviderMismatchError,
  SpendLimitReachedError,
  UnresolvableDriverError,
  type DriverProvider,
  type InvocationOrigin,
  type InvocationsService,
  type ScriptOutputs,
  type SpawnInput,
} from "../../modules/invocations/index.js";
import { securityLog } from "../../core/security-log.js";
import { DEFAULT_TEMPLATE_ID } from "../../modules/templates/index.js";
import {
  isNoDefaultModelError,
  type FirePair,
} from "../../modules/harness-config/index.js";

export type SpawnRequest = z.infer<typeof spawnInvocationRequestSchema>;
export type ScriptSpawnRequest = z.infer<
  typeof spawnScriptInvocationRequestSchema
>;
type SpawnTargetRequest = Omit<ScriptSpawnRequest, "script">;

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
  defaultModel?: (driverId: string, harness: string) => Promise<string | null>;
  scriptOutputs: Pick<ScriptOutputs, "link" | "ack" | "preview">;
}

const NO_SCRIPT_SPAWN_MODEL_MESSAGE =
  "nothing names the sub-agent's model: pass a provider-qualified model, as the agent's Config panel lists it, or spawn on the harness of this agent's default model to run on that model; an agent with no default gets one on its Providers page";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the model of the driver's saved chat default, when
 * that default runs on the harness asked for; null when it runs on another
 * harness or names no model, so nothing is ever picked in the owner's place.
 * An older runtime's bare model name is none either, since the spawn route
 * takes provider-qualified names only.
 */
export function driverDefaultModel(
  firePair: FirePair,
): NonNullable<DriverOpsDeps["defaultModel"]> {
  return async (driverId, harness) => {
    const pair = await firePair(driverId, "chat", { harness }).catch(
      (err: unknown) => {
        if (isNoDefaultModelError(err)) return null;
        throw err;
      },
    );
    return pair?.harness === harness && isQualifiedModel(pair.model)
      ? pair.model
      : null;
  };
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

  /**
   * UNIT_BOUNDARY_DESCRIPTION: a driver script has no Session to inherit a
   * model from, so a script spawn that names none, on the harness the
   * driver's saved default runs on, runs on that default's model, the one
   * its owner chose. A spawn that names a model keeps it; one of an image,
   * one on another harness and one from a driver with no default name none,
   * and the service refuses them as before.
   */
  const withDefaultModel = async (
    body: SpawnRequest,
    origin: InvocationOrigin,
  ): Promise<SpawnRequest["harnessConfig"]> => {
    if (
      origin !== "script" ||
      body.harnessConfig?.model !== undefined ||
      body.image !== undefined ||
      body.harness === undefined ||
      !deps.defaultModel
    )
      return body.harnessConfig;
    const model = await deps.defaultModel(driverId, body.harness);
    return model ? { ...body.harnessConfig, model } : body.harnessConfig;
  };

  const resolveSpawn = async (
    body: SpawnTargetRequest,
  ): Promise<
    | Extract<SpawnOutcome, { ok: false }>
    | {
        ok: true;
        target: SpawnInput["target"];
        setup: SpawnInput["setup"];
        connections: string[];
        driverGrantIds: string[];
        providers: ReturnType<typeof providersOf>;
      }
  > => {
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
      const matches = templates.filter((t) => t.spec.harness === body.harness);
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

    return {
      ok: true,
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
      driverGrantIds,
      providers: providersOf(owned, grantSet),
    };
  };

  const refusalOf = (err: unknown, origin: InvocationOrigin): SpawnOutcome => {
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
    if (err instanceof NoSpawnModelError) {
      return {
        ok: false,
        kind: "invalid",
        message:
          origin === "script" ? NO_SCRIPT_SPAWN_MODEL_MESSAGE : err.message,
      };
    }
    if (
      err instanceof UnresolvableDriverError ||
      err instanceof NoOutputStoreError
    ) {
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
  };

  return {
    async spawn(
      body: SpawnRequest,
      from: { origin: InvocationOrigin; driverSessionId?: string | null } = {
        origin: "script",
      },
    ): Promise<SpawnOutcome> {
      const base = await resolveSpawn(body);
      if (!base.ok) return base;
      const { target, setup, connections, driverGrantIds } = base;
      const { driverProviders, attachableProviders } = base.providers;
      const harnessConfig = await withDefaultModel(body, from.origin);

      try {
        const { id } = await invocations.spawn({
          driverAgentId: driverId,
          driverGrantIds,
          driverProviders,
          attachableProviders,
          target,
          setup,
          connections,
          prompt: body.prompt,
          schema: body.schema,
          ...(body.label !== undefined ? { label: body.label } : {}),
          ...(body.ttlMs !== undefined ? { ttlMs: body.ttlMs } : {}),
          ...(harnessConfig ? { harnessConfig } : {}),
          origin: from.origin,
          driverSessionId: from.driverSessionId ?? null,
        });
        return { ok: true, id };
      } catch (err) {
        return refusalOf(err, from.origin);
      }
    },

    async spawnScript(
      body: ScriptSpawnRequest,
      from: { origin: InvocationOrigin; driverSessionId?: string | null } = {
        origin: "script",
      },
    ): Promise<SpawnOutcome> {
      const base = await resolveSpawn(body);
      if (!base.ok) return base;
      try {
        const { id } = await invocations.spawnScript({
          driverAgentId: driverId,
          driverGrantIds: base.driverGrantIds,
          target: base.target,
          setup: base.setup,
          connections: base.connections,
          script: body.script,
          ...(body.label !== undefined ? { label: body.label } : {}),
          ...(body.ttlMs !== undefined ? { ttlMs: body.ttlMs } : {}),
          origin: from.origin,
          driverSessionId: from.driverSessionId ?? null,
        });
        return { ok: true, id };
      } catch (err) {
        return refusalOf(err, from.origin);
      }
    },

    outputLink: (
      invocationId: string,
      stream: InvocationOutputStream,
    ): Promise<InvocationOutputLink | null> =>
      deps.scriptOutputs.link(invocationId, driverId, stream),

    ackOutput: (
      invocationId: string,
      stream: InvocationOutputStream,
    ): Promise<boolean> =>
      deps.scriptOutputs.ack(invocationId, driverId, stream),

    outputPreview: (
      invocationId: string,
      stream: InvocationOutputStream,
      edgeBytes: number,
    ) => deps.scriptOutputs.preview(invocationId, driverId, stream, edgeBytes),

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
      const providers = providersOf(
        owned,
        new Set(granted.connections.map((g) => g.connectionId)),
      );
      const runsOn = (
        harness: SpawnInput["target"]["harness"],
        runsOnTypes: ProviderPresetType[] | undefined,
      ) =>
        match(
          invocations.reachability({
            ...providers,
            target: {
              ...(harness && { harness }),
              ...(runsOnTypes && { runsOn: runsOnTypes }),
            },
          }),
        )
          .with({ kind: "runs" }, ({ provider }) => ({
            provider: PROVIDERS[provider].displayName,
          }))
          .with({ kind: "refused" }, ({ reason }) => ({ unavailable: reason }))
          .with({ kind: "unnarrowed" }, () => ({}))
          .exhaustive();
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
                ...(t.spec.harness ? runsOn(undefined, t.spec.providers) : {}),
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
