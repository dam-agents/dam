import { match } from "ts-pattern";
import type { z } from "zod";
import {
  isQualifiedModel,
  PROVIDERS,
  providerTypeForTemplateId,
  type BudgetsService,
  type ChildConnections,
  type ChildEgress,
  type ChildEgressRule,
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
  AttenuationError,
  KeepError,
  RunError,
  OpenEgressConnectionsError,
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
  type SpawnTarget,
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
  defaultModel?: (driverId: string, harness: string) => Promise<string | null>;
  scriptOutputs: Pick<ScriptOutputs, "link" | "ack" | "preview">;
  childEgress?: {
    setOpenRules(
      agentId: string,
      decidedBy: string,
      rules: readonly ChildEgressRule[],
    ): Promise<{
      waiting: { host: string; id: string }[];
      blocked: { host: string }[];
    }>;
  };
  inheritanceOf?: (agentId: string) => Promise<{
    parentAgentId: string;
    egressFrom: "parent" | "open" | "scoped";
  } | null>;
}

const NO_SCRIPT_SPAWN_MODEL_MESSAGE =
  "nothing names the sub-agent's model: pass a provider-qualified model, as the agent's Config panel lists it, or spawn on the harness of this agent's default model to run on that model; an agent with no default gets one on its Providers page";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the model of the driver's chat default, saved or
 * automatic, when it runs on the harness asked for; null when it runs on
 * another harness or has no model.
 * An older runtime's bare model name is none either, since the spawn route
 * takes provider-qualified names only.
 */
export function driverDefaultModel(
  firePair: FirePair,
): NonNullable<DriverOpsDeps["defaultModel"]> {
  return async (driverId, harness) => {
    const pair = await firePair(driverId, "chat", {}).catch((err: unknown) => {
      if (isNoDefaultModelError(err)) return null;
      throw err;
    });
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

  // UNIT_BOUNDARY_DESCRIPTION: the template, image and providers a harness name runs on, for a spawn and for a later run in its sub-agent alike; a harness this install has no single template for is refused, naming the ones it has.
  const targetFor = async (body: {
    harness?: string;
    image?: string;
  }): Promise<
    Extract<SpawnOutcome, { ok: false }> | { ok: true; target: SpawnTarget }
  > => {
    const target: SpawnTarget = body.image ? { image: body.image } : {};
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
    return { ok: true, target };
  };

  const resolveSpawn = async (
    body: SpawnTargetRequest,
  ): Promise<
    | Extract<SpawnOutcome, { ok: false }>
    | {
        ok: true;
        target: SpawnInput["target"];
        setup: SpawnInput["setup"];
        connections: ChildConnections;
        egress?: ChildEgress;
        keep?: { keepForMs?: number; idleTimeoutMin?: number };
        driverGrantIds: string[];
        providers: ReturnType<typeof providersOf>;
      }
  > => {
    if (body.idleTimeoutMin !== undefined && !body.keep)
      return {
        ok: false,
        kind: "invalid",
        message:
          "idleTimeout goes with keep: a sub-agent that is not kept is removed after its result",
      };
    const resolved = await targetFor(body);
    if (!resolved.ok) return resolved;
    const { target } = resolved;

    const connections = body.connections ?? "none";
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
        ...(body.resources ? { resources: body.resources } : {}),
        env: body.env,
        skills: body.skills,
      },
      connections,
      ...(body.egress ? { egress: body.egress } : {}),
      ...(body.keep
        ? {
            keep: {
              ...(body.keepForMs !== undefined && {
                keepForMs: body.keepForMs,
              }),
              ...(body.idleTimeoutMin !== undefined && {
                idleTimeoutMin: body.idleTimeoutMin,
              }),
            },
          }
        : {}),
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
      err instanceof ModelNameError ||
      err instanceof ProviderMismatchError ||
      err instanceof OpenEgressConnectionsError ||
      err instanceof KeepError
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
      const { target, setup, connections, egress, keep, driverGrantIds } = base;
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
          ...(egress ? { egress } : {}),
          ...(keep ? { keep: true, ...keep } : {}),
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
          ...(base.egress ? { egress: base.egress } : {}),
          ...(base.keep ? { keep: true, ...base.keep } : {}),
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

    // UNIT_BOUNDARY_DESCRIPTION: a clean slate: the sub-agent boots with its setup and runs nothing until runSubagent starts a run in it.
    async spawnIdle(
      body: Omit<ScriptSpawnRequest, "script">,
      from: { origin: InvocationOrigin; driverSessionId?: string | null } = {
        origin: "script",
      },
    ): Promise<SpawnOutcome> {
      const base = await resolveSpawn(body);
      if (!base.ok) return base;
      try {
        const { id } = await invocations.spawnIdle({
          driverAgentId: driverId,
          driverGrantIds: base.driverGrantIds,
          driverProviders: base.providers.driverProviders,
          target: base.target,
          setup: base.setup,
          connections: base.connections,
          ...(base.egress ? { egress: base.egress } : {}),
          ...(base.keep ? { keep: true, ...base.keep } : {}),
          prompt: "",
          schema: null,
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

    // UNIT_BOUNDARY_DESCRIPTION: wakes a sleeping sub-agent of this driver's; a refusal says why.
    async wakeSubagent(
      id: string,
    ): Promise<{ ok: true } | { ok: false; message: string }> {
      try {
        await invocations.wakeTarget(id, driverId);
        return { ok: true };
      } catch (err) {
        if (err instanceof RunError) return { ok: false, message: err.message };
        throw err;
      }
    },

    // UNIT_BOUNDARY_DESCRIPTION: stops a sub-agent of this driver's and every sub-agent below it; a refusal says why, and one with nothing running says it was not stopped.
    async stopSubagent(
      id: string,
      reason?: string,
    ): Promise<
      { ok: true; stopped: boolean } | { ok: false; message: string }
    > {
      try {
        const { stopped } = await invocations.stopTarget(id, driverId, reason);
        return { ok: true, stopped };
      } catch (err) {
        if (err instanceof RunError) return { ok: false, message: err.message };
        throw err;
      }
    },

    // UNIT_BOUNDARY_DESCRIPTION: starts a run in an idle or kept sub-agent of this driver, refused for the same reasons a spawn is: a task runs on the model named, or this driver's default on the sub-agent's harness, and on a provider the sub-agent holds. Its result goes to the caller that started it.
    async runSubagent(
      id: string,
      run:
        | { prompt: string; schema: unknown; model?: string; session?: string }
        | { script: string },
      caller: {
        ttlMs?: number;
        origin: InvocationOrigin;
        driverSessionId?: string | null;
      } = { origin: "script" },
    ): Promise<
      | { ok: true; run: string; session: string | null }
      | Extract<SpawnOutcome, { ok: false }>
    > {
      const from = {
        ...(caller.ttlMs !== undefined ? { ttlMs: caller.ttlMs } : {}),
        origin: caller.origin,
        driverSessionId: caller.driverSessionId ?? null,
      };
      try {
        if (!(await invocations.get(id, driverId)))
          return {
            ok: false,
            kind: "conflict",
            message: `${id} is not a sub-agent of yours`,
          };
        if ("script" in run) {
          const started = await invocations.runSubagent(
            id,
            driverId,
            run,
            from,
          );
          return { ok: true, ...started };
        }
        const harness = (await deps.agents.get(id))?.spec.harness;
        const model =
          run.model ??
          (harness ? await deps.defaultModel?.(driverId, harness) : null);
        if (!model)
          return {
            ok: false,
            kind: "invalid",
            message:
              "nothing names the run's model: pass a provider-qualified model, or set this agent's default model on the sub-agent's harness",
          };
        const resolved = await targetFor({ harness });
        if (!resolved.ok) return resolved;
        const [granted, owned] = await Promise.all([
          conns.getAgentConnections(id),
          conns.listConnections(),
        ]);
        const held = providersOf(
          owned,
          new Set(granted.connections.map((g) => g.connectionId)),
        );
        const started = await invocations.runSubagent(
          id,
          driverId,
          {
            prompt: run.prompt,
            schema: run.schema,
            harnessConfig: { model },
            modelNamed: run.model !== undefined,
            ...(run.session !== undefined && { session: run.session }),
            target: resolved.target,
            ...held,
          },
          from,
        );
        return { ok: true, ...started };
      } catch (err) {
        if (err instanceof RunError)
          return { ok: false, kind: "conflict", message: err.message };
        const refused = refusalOf(err, caller.origin);
        if (!refused.ok) return refused;
        throw err;
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

    // UNIT_BOUNDARY_DESCRIPTION: moves a kept sub-agent's keep expiry, or the idle time after which it sleeps; a sub-agent that is not this driver's, or was not spawned with keep, is refused with the reason.
    async extendKeep(
      id: string,
      change: { keepForMs?: number; idleTimeoutMin?: number },
    ): Promise<
      | { ok: true; keepUntil: string; idleTimeoutMin?: number }
      | { ok: false; message: string }
    > {
      try {
        const { keepUntil, idleTimeoutMin } = await invocations.extendKeep(
          id,
          driverId,
          change,
        );
        return {
          ok: true,
          keepUntil: keepUntil.toISOString(),
          ...(idleTimeoutMin !== undefined && { idleTimeoutMin }),
        };
      } catch (err) {
        if (err instanceof KeepError)
          return { ok: false, message: err.message };
        throw err;
      }
    },

    // UNIT_BOUNDARY_DESCRIPTION: replaces the rules of a child whose egress is open, which only the agent that launched it may set; a child that follows its parent, or whose scoped rules only the user widens, is refused.
    async setChildEgress(
      childId: string,
      rules: readonly ChildEgressRule[],
    ): Promise<
      | {
          ok: true;
          waiting: { host: string; id: string }[];
          blocked: { host: string }[];
        }
      | { ok: false; message: string }
    > {
      const inherited = await deps.inheritanceOf?.(childId);
      if (!inherited || inherited.parentAgentId !== driverId)
        return { ok: false, message: `${childId} is not a child you launched` };
      if (inherited.egressFrom !== "open")
        return {
          ok: false,
          message:
            inherited.egressFrom === "scoped"
              ? `${childId} has scoped egress, which only the user widens`
              : `${childId} follows your egress; launch it with egress "open" to set its own`,
        };
      const { waiting, blocked } = await deps.childEgress!.setOpenRules(
        childId,
        driverId,
        rules,
      );
      return { ok: true, waiting, blocked };
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
        return t.id === DEFAULT_TEMPLATE_ID
          ? deps.harnesses.harnesses.map((h) => ({
              id: t.id,
              name: h.displayName,
              image: t.spec.image,
              description: h.description,
              harness: h.name,
              ...runsOn(h.name, h.providers),
            }))
          : [
              {
                id: t.id,
                name: t.name,
                image: t.spec.image,
                description: t.spec.description,
                ...(t.spec.harness ? { harness: t.spec.harness } : {}),
                ...(t.spec.harness ? runsOn(undefined, t.spec.providers) : {}),
              },
            ];
      });
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
