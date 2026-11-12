import { TRPCError } from "@trpc/server";
import { lentSubagentOfProfile } from "agent-runtime-api";
import {
  aliasForProviderType,
  aliasForTemplateId,
  CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
  CURVE_BENDER_WORK_MODEL,
  displayNameForTemplate,
  harnessFits,
  parseQualifiedModel,
  PROVIDER_TEMPLATE_IDS,
  providerAliasConflict,
  providerTypeForTemplateId,
  type HarnessCatalog,
  type ProfileCreateInput,
  type ProfilesService,
  type ProfileWithUsage,
  type SessionPair,
} from "api-server-api";
import { isUniqueViolation } from "../../../core/db-errors.js";
import { getLogger } from "../../../core/logger.js";
import {
  type ProfileReferences,
  type ProfileRow,
  type ProfilesRepository,
} from "../infrastructure/profiles-repository.js";

export interface ResolvedProfile {
  profile: ProfileRow;
  /** UNIT_BOUNDARY_DESCRIPTION: the primary model alone, so a caller that overrides the subagent slot never inherits half of the profile's. */
  pair: SessionPair;
  /** UNIT_BOUNDARY_DESCRIPTION: why the primary model cannot run on the agent, or null; a run never substitutes another provider or model for it. */
  unavailable: string | null;
  /** UNIT_BOUNDARY_DESCRIPTION: the platform sub-agent the profile names, as a run takes it, or null when it names none; it reaches a run only where its slot holds nothing of its own. */
  subagent: Record<string, string> | null;
  /** UNIT_BOUNDARY_DESCRIPTION: why that sub-agent cannot run on the agent, or null; it says nothing about the primary, since a slot of its own never runs it. */
  subagentUnavailable: string | null;
  /** UNIT_BOUNDARY_DESCRIPTION: the owner holds the provider and the agent does not, with no rival of its alias granted, so a pick may grant it first. */
  attachable: boolean;
}

/** UNIT_BOUNDARY_DESCRIPTION: a stored reference passes no owner, because the row holding it is the authority; a write passes the caller's, so another owner's profile can never be attached. */
export type ProfileResolver = (input: {
  profileId: string;
  agentId: string;
  owner?: string;
}) => Promise<ResolvedProfile | null>;

/**
 * UNIT_BOUNDARY_DESCRIPTION: the one place a profile becomes a pair for an
 * agent. A profile names a provider template, so the Connection is the agent's
 * grant of that template, else the owner's oldest one, which runs only once it
 * is granted and only while no rival Connection of the same alias is.
 */
export function profileResolver(repo: ProfilesRepository): ProfileResolver {
  return async ({ profileId, agentId, owner }) => {
    const profile = await repo.get(profileId, owner);
    if (!profile) return null;
    const [owned, granted] = await Promise.all([
      repo.ownerConnections(profile.owner),
      repo.agentConnections(profile.owner, agentId),
    ]);
    /* UNIT_BOUNDARY_DESCRIPTION: the agent's grant of that template, else the owner's oldest one, and whether it is granted, which runs only once it is. */
    const connectionOf = (templateId: string) => {
      const ofTemplate = owned.filter((c) => c.templateId === templateId);
      const connection =
        ofTemplate.find((c) => granted.some((g) => g.id === c.id)) ??
        ofTemplate[0];
      return {
        connection,
        isGranted:
          connection !== undefined &&
          granted.some((g) => g.id === connection.id),
      };
    };
    const nameOf = (templateId: string) =>
      displayNameForTemplate(templateId) ?? templateId;
    const { connection, isGranted } = connectionOf(profile.providerTemplate);
    const rival =
      connection && !isGranted
        ? providerAliasConflict(granted, connection)
        : null;
    /* UNIT_BOUNDARY_DESCRIPTION: a sub-agent the profile names runs on the
     * agent's Connection of its own template, which is the primary's when the
     * two name one template. It is kept apart from the primary's availability:
     * a slot with a sub-agent of its own never runs it (D193B). */
    const subagentConnection =
      profile.subagentProviderTemplate !== null &&
      profile.subagentProviderTemplate === profile.providerTemplate
        ? { connection, isGranted }
        : profile.subagentProviderTemplate === null
          ? null
          : connectionOf(profile.subagentProviderTemplate);
    const subagentName = profile.subagentProviderTemplate
      ? nameOf(profile.subagentProviderTemplate)
      : null;
    return {
      profile,
      pair: {
        harness: profile.harness,
        provider: isGranted ? connection.id : null,
        model: profile.model,
        ...(Object.keys(profile.settings).length > 0 && {
          settings: profile.settings,
        }),
      },
      unavailable: !connection
        ? `${nameOf(profile.providerTemplate)} is not connected`
        : rival
          ? `this agent runs on ${rival.held.name}; detach it to use ${connection.name}`
          : !isGranted
            ? `${nameOf(profile.providerTemplate)} isn't attached to this agent`
            : null,
      /* UNIT_BOUNDARY_DESCRIPTION: a profile lends its sub-agent as the slot it would be, platform keys only, by the one mapping the picker uses too (D193B). */
      subagent: lentSubagentOfProfile({
        harness: profile.harness,
        settings: profile.settings,
        subagent:
          profile.subagentModel === null
            ? null
            : { model: profile.subagentModel },
      }),
      subagentUnavailable:
        profile.subagentModel === null
          ? null
          : !subagentConnection?.connection
            ? `${subagentName}, its sub-agent's provider, is not connected`
            : !subagentConnection.isGranted
              ? `${subagentName}, its sub-agent's provider, isn't attached to this agent`
              : null,
      attachable: connection !== undefined && !isGranted && !rival,
    };
  };
}

interface OwnerDeps {
  repo: ProfilesRepository;
  owner: string;
  catalog: Pick<HarnessCatalog, "default" | "harnesses">;
  /* UNIT_BOUNDARY_DESCRIPTION: the install serves the shared CurveBender, so a new agent of an owner with no default profile starts on the base default. */
  sharedCurveBender: boolean;
}

/* UNIT_BOUNDARY_DESCRIPTION: the base default a new agent's chat default is initialised with when its owner has no default profile: Pi on the shared CurveBender's work model, saved as values, never as a profile. */
export const BASE_DEFAULT = {
  harness: "pi",
  providerTemplate: CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
  model: `${aliasForTemplateId(CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID)!}/${CURVE_BENDER_WORK_MODEL}`,
};

export interface NewAgentDefault {
  /** UNIT_BOUNDARY_DESCRIPTION: the profile the owner chose, or null for values: their own or the base default's. */
  profile: ProfileRow | null;
  /** UNIT_BOUNDARY_DESCRIPTION: the pair a new agent's chat default is initialised with when it holds no profile; it names the Connection below. */
  pair: SessionPair & { model: string };
  connectionId: string;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: what a new Agent starts on: the default for new
 * agents the owner chose, a profile or their own values, else the base
 * default where the install serves the shared CurveBender and runs Pi; a
 * choice whose provider the owner no longer holds falls to the base default
 * too. A profile runs on the owner's oldest Connection of its template, which
 * the Agent is granted in place of the harness's provider order. The
 * deployment-owned Connections come from the owner's Connection listing or a
 * boot sweep over owners who already hold one, so a default naming one
 * reconciles them first; a first create through the CLI or API would
 * otherwise find none. Null while there is no default or no such Connection,
 * which leaves the new Agent to that order and its first hello's conversion.
 */
export async function newAgentDefault(
  deps: OwnerDeps & { reconcileConnections?: () => Promise<void> },
): Promise<NewAgentDefault | null> {
  let owned = await deps.repo.ownerConnections(deps.owner);
  const ofTemplate = async (templateId: string) => {
    let connection = owned.find((c) => c.templateId === templateId);
    if (
      !connection &&
      templateId === CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID &&
      deps.reconcileConnections
    ) {
      await deps.reconcileConnections();
      owned = await deps.repo.ownerConnections(deps.owner);
      connection = owned.find((c) => c.templateId === templateId);
    }
    return connection;
  };
  const chosen = await deps.repo.newAgentDefaultOf(deps.owner);
  if (chosen?.profile) {
    const { profile } = chosen;
    const connection = await ofTemplate(profile.providerTemplate);
    if (connection)
      return {
        profile,
        pair: {
          harness: profile.harness,
          provider: connection.id,
          model: profile.model,
        },
        connectionId: connection.id,
      };
  }
  const own = chosen?.pair;
  if (own?.provider && own.model && owned.some((c) => c.id === own.provider))
    return {
      profile: null,
      pair: { ...own, model: own.model },
      connectionId: own.provider,
    };
  const base = baseDefault(deps);
  const connection = base && (await ofTemplate(base.providerTemplate));
  return base && connection
    ? {
        profile: null,
        pair: {
          harness: base.harness,
          provider: connection.id,
          model: base.model,
        },
        connectionId: connection.id,
      }
    : null;
}

const baseDefault = (deps: Pick<OwnerDeps, "catalog" | "sharedCurveBender">) =>
  deps.sharedCurveBender &&
  deps.catalog.harnesses.some((h) => h.name === BASE_DEFAULT.harness)
    ? BASE_DEFAULT
    : null;

/** UNIT_BOUNDARY_DESCRIPTION: a new Agent's chat default is initialised from its default once it holds that default's Connection: the profile, else the values; a create that named another provider keeps its first hello's conversion. Answers why it did not bind, null when it did. */
export async function bindNewAgentDefault(
  deps: Pick<OwnerDeps, "repo" | "owner">,
  agentId: string,
  start: NewAgentDefault,
): Promise<string | null> {
  const granted = await deps.repo.agentConnections(deps.owner, agentId);
  if (!granted.some((c) => c.id === start.connectionId))
    return `the agent does not hold Connection ${start.connectionId}`;
  return (await deps.repo.bindChatDefault(
    deps.owner,
    agentId,
    start.profile
      ? { sessionProfile: start.profile.id }
      : { sessionPair: start.pair },
  ))
    ? null
    : "the agent already holds a chat default";
}

export function createProfilesService(
  deps: OwnerDeps & {
    agentBinding: readonly string[] | "*";
    resolve: ProfileResolver;
    /* UNIT_BOUNDARY_DESCRIPTION: sends an agent that points at an edited profile its new pair, or answers why it cannot take it. */
    republish: (agentId: string) => Promise<string | null>;
    /* UNIT_BOUNDARY_DESCRIPTION: why values saved as a default could not run with their settings, as an agent's chat default checks them, or null. */
    settingsProblem: (pair: SessionPair) => Promise<string | null>;
  },
): ProfilesService {
  const { repo, owner, catalog } = deps;
  const agentIds = deps.agentBinding === "*" ? undefined : deps.agentBinding;

  /* UNIT_BOUNDARY_DESCRIPTION: the sub-agent the profile names rides the pair its slots resolve to, so these are the columns that carry it. */
  const subagentColumns = (
    subagent: ProfileCreateInput["subagent"] = null,
  ) => ({
    subagentProviderTemplate: subagent?.providerTemplate ?? null,
    subagentModel: subagent?.model ?? null,
  });

  function problemWith(
    harness: string,
    providerTemplate: string,
    model: string,
  ): string | null {
    const type = providerTypeForTemplateId(providerTemplate);
    const alias = parseQualifiedModel(model, { claudePrefix: true })?.alias;
    return !catalog.harnesses.some((h) => h.name === harness)
      ? `unknown harness ${harness}`
      : type === null || !PROVIDER_TEMPLATE_IDS.has(providerTemplate)
        ? `unknown provider ${providerTemplate}`
        : alias !== aliasForProviderType(type)
          ? `${model} is not a ${providerTemplate} model`
          : !harnessFits(catalog, harness, type, providerTemplate)
            ? `the ${harness} harness cannot run on ${providerTemplate}`
            : null;
  }

  function validate(
    profile: Pick<
      ProfileRow,
      | "harness"
      | "providerTemplate"
      | "model"
      | "subagentProviderTemplate"
      | "subagentModel"
    >,
  ): void {
    const { harness } = profile;
    const problem =
      problemWith(harness, profile.providerTemplate, profile.model) ??
      (profile.subagentProviderTemplate !== null &&
      profile.subagentModel !== null
        ? problemWith(
            harness,
            profile.subagentProviderTemplate,
            profile.subagentModel,
          )
        : null);
    if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: problem });
  }

  function view(
    row: ProfileRow,
    refs: ProfileReferences,
    availability: ProfileWithUsage["availability"] = null,
  ): ProfileWithUsage {
    return {
      id: row.id,
      name: row.name,
      harness: row.harness,
      providerTemplate: row.providerTemplate,
      model: row.model,
      subagent:
        row.subagentProviderTemplate !== null && row.subagentModel !== null
          ? {
              providerTemplate: row.subagentProviderTemplate,
              model: row.subagentModel,
            }
          : null,
      settings: row.settings,
      usage: {
        agents: refs.agents.filter(
          (a) => a.chat === row.id || a.platform === row.id,
        ).length,
        channels: refs.channels.filter((c) => c.profileId === row.id).length,
        schedules: refs.schedules.filter((s) => s.profileId === row.id).length,
        artifacts: refs.artifacts.filter((a) => a.profileId === row.id).length,
      },
      availability,
    };
  }

  async function owned(id: string): Promise<ProfileRow> {
    const row = await repo.get(id, owner);
    if (!row)
      throw new TRPCError({ code: "NOT_FOUND", message: "profile not found" });
    return row;
  }

  const duplicate = (err: unknown, name: string) =>
    isUniqueViolation(err)
      ? new TRPCError({
          code: "CONFLICT",
          message: `A profile named ${name} already exists.`,
        })
      : err;

  return {
    async list(input) {
      const [rows, refs] = await Promise.all([
        repo.list(owner),
        repo.references(owner, agentIds),
      ]);
      const agentId = input?.agentId;
      return Promise.all(
        rows.map(async (row) => {
          if (agentId === undefined) return view(row, refs);
          const resolved = await deps.resolve({ profileId: row.id, agentId });
          return view(row, refs, {
            available: !resolved?.unavailable || resolved.attachable,
            reason: resolved?.unavailable ?? null,
            attachable: resolved?.attachable ?? false,
          });
        }),
      );
    },

    async usage(id) {
      await owned(id);
      const refs = await repo.references(owner, agentIds, id);
      return {
        agents: refs.agents.map((a) => ({ id: a.id })),
        channels: refs.channels.map(({ agentId, label }) => ({
          agentId,
          label,
        })),
        schedules: refs.schedules.map(({ id, name, agentId }) => ({
          id,
          name,
          agentId,
        })),
        artifacts: refs.artifacts.map(({ id, title, agentId }) => ({
          id,
          title,
          agentId,
        })),
      };
    },

    async create(input) {
      const columns = subagentColumns(input.subagent);
      validate({ ...input, ...columns });
      const row = await repo
        .insert(owner, {
          name: input.name,
          harness: input.harness,
          providerTemplate: input.providerTemplate,
          model: input.model,
          settings: input.settings ?? {},
          ...columns,
        })
        .catch((err: unknown) => {
          throw duplicate(err, input.name);
        });
      return view(row, await repo.references(owner, agentIds, row.id));
    },

    async update({ id, agentId: _agentId, subagent, ...patch }) {
      const current = await owned(id);
      const subagentPatch =
        subagent === undefined ? {} : subagentColumns(subagent);
      validate({ ...current, ...patch, ...subagentPatch });
      const written = await repo
        .update(owner, id, { ...patch, ...subagentPatch })
        .catch((err: unknown) => {
          throw duplicate(err, patch.name ?? current.name);
        });
      const renameOnly =
        subagent === undefined &&
        Object.keys(patch).every((key) => key === "name");
      const { agents } = await repo.references(owner, undefined, id);
      const rejected = renameOnly
        ? []
        : (
            await Promise.all(
              agents.map((a) =>
                deps
                  .republish(a.id)
                  .catch((err: unknown) => String(err))
                  .then((reason) =>
                    reason === null ? null : { agentId: a.id, reason },
                  ),
              ),
            )
          ).filter((r) => r !== null);
      /* UNIT_BOUNDARY_DESCRIPTION: an edit no agent that uses the profile can run is put back, or every new chat on them would fail on it (QA D5); a partial rejection keeps the edit, and those agents keep the pair they hold until fixed. */
      if (rejected.length > 0 && rejected.length === agents.length) {
        const {
          name,
          harness,
          providerTemplate,
          model,
          subagentProviderTemplate,
          subagentModel,
          settings,
        } = current;
        /* UNIT_BOUNDARY_DESCRIPTION: the revert is a compare-and-set against the version this call wrote, so an edit that landed while the fan-out ran stays; undoing it would lose a newer edit that was already answered. */
        await repo.update(
          owner,
          id,
          {
            name,
            harness,
            providerTemplate,
            model,
            subagentProviderTemplate,
            subagentModel,
            settings,
          },
          {
            expect: written?.updatedAt ?? current.updatedAt,
            at: current.updatedAt,
          },
        );
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `No agent can run this profile: ${rejected[0]!.reason}`,
        });
      }
      if (rejected.length > 0)
        getLogger().warn({ profileId: id, rejected }, "profile edit rejected");
      return view(await owned(id), await repo.references(owner, agentIds, id));
    },

    async newAgentDefault() {
      const [chosen, connections] = await Promise.all([
        repo.newAgentDefaultOf(owner),
        repo.ownerConnections(owner),
      ]);
      const base = baseDefault(deps);
      const shared =
        base && connections.find((c) => c.templateId === base.providerTemplate);
      const profile = chosen?.profile;
      return {
        profileId: profile?.id ?? null,
        /* UNIT_BOUNDARY_DESCRIPTION: a profile's values on the owner's oldest Connection of its template, so a picker shows what the reference runs on. */
        pair: profile
          ? {
              harness: profile.harness,
              provider:
                connections.find(
                  (c) => c.templateId === profile.providerTemplate,
                )?.id ?? null,
              model: profile.model,
              ...(Object.keys(profile.settings).length > 0 && {
                settings: profile.settings,
              }),
            }
          : (chosen?.pair ?? null),
        base:
          base && shared
            ? { harness: base.harness, provider: shared.id, model: base.model }
            : null,
      };
    },

    async setNewAgentDefault(input) {
      if ("profileId" in input) {
        await owned(input.profileId);
        return repo.setNewAgentDefault(owner, { profileId: input.profileId });
      }
      const { pair } = input;
      const connection = (await repo.ownerConnections(owner)).find(
        (c) => c.id === pair.provider,
      );
      if (!connection)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `unknown provider ${pair.provider}`,
        });
      const problem =
        problemWith(pair.harness, connection.templateId, pair.model) ??
        (await deps.settingsProblem(pair));
      if (problem)
        throw new TRPCError({ code: "BAD_REQUEST", message: problem });
      await repo.setNewAgentDefault(owner, { sessionPair: pair });
    },

    async delete(id) {
      const outcome = await repo.deleteIfUnused(owner, id, agentIds);
      if (outcome === "missing")
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "profile not found",
        });
      if (outcome !== "deleted") {
        const count = (n: number, what: string) =>
          n === 0 ? [] : [`${n} ${what}${n === 1 ? "" : "s"}`];
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `That profile is in use by ${[
            ...count(outcome.agents.length, "agent"),
            ...count(outcome.channels.length, "channel"),
            ...count(outcome.schedules.length, "schedule"),
            ...count(outcome.artifacts.length, "artifact"),
          ].join(", ")}.`,
        });
      }
    },
  };
}
