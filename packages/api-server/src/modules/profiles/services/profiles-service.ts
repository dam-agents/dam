import { TRPCError } from "@trpc/server";
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
  type ProfilesService,
  type ProfileWithUsage,
  type SessionPair,
} from "api-server-api";
import { isUniqueViolation } from "../../../core/db-errors.js";
import { getLogger } from "../../../core/logger.js";
import {
  SEEDED_DEFAULT,
  type ProfileReferences,
  type ProfileRow,
  type ProfilesRepository,
} from "../infrastructure/profiles-repository.js";

export interface ResolvedProfile {
  profile: ProfileRow;
  pair: SessionPair;
  /** UNIT_BOUNDARY_DESCRIPTION: why the profile cannot run on the agent, or null; a run never substitutes another provider or model for it. */
  unavailable: string | null;
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
    const ofTemplate = owned.filter(
      (c) => c.templateId === profile.providerTemplate,
    );
    const connection =
      ofTemplate.find((c) => granted.some((g) => g.id === c.id)) ??
      ofTemplate[0];
    const isGranted =
      connection !== undefined && granted.some((g) => g.id === connection.id);
    const rival =
      connection && !isGranted
        ? providerAliasConflict(granted, connection)
        : null;
    const providerName =
      displayNameForTemplate(profile.providerTemplate) ??
      profile.providerTemplate;
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
        ? `${providerName} is not connected`
        : rival
          ? `this agent runs on ${rival.held.name}; detach it to use ${connection.name}`
          : !isGranted
            ? `${providerName} isn't attached to this agent`
            : null,
      attachable: connection !== undefined && !isGranted && !rival,
    };
  };
}

interface OwnerDeps {
  repo: ProfilesRepository;
  owner: string;
  catalog: Pick<HarnessCatalog, "default" | "harnesses">;
  /* UNIT_BOUNDARY_DESCRIPTION: whether the deployment serves the shared CurveBender the seeded Default runs on; without it nothing is seeded and no marker is claimed, so configuring it later still seeds. */
  sharedProvider: boolean;
}

async function seedDefault(deps: OwnerDeps): Promise<void> {
  if (!deps.sharedProvider) return;
  await deps.repo.seed(deps.owner, {
    name: "Default",
    harness: deps.catalog.default,
    providerTemplate: CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
    model: `${aliasForTemplateId(CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID)!}/${CURVE_BENDER_WORK_MODEL}`,
    settings: {},
  });
}

/** UNIT_BOUNDARY_DESCRIPTION: a new Agent starts on its owner's seeded Default when its harness and granted provider fit; otherwise its first hello converts a default as before. */
export async function bindDefaultProfile(
  deps: OwnerDeps,
  agentId: string,
  harness: string,
): Promise<void> {
  await seedDefault(deps);
  const seeded = await deps.repo.seeded(deps.owner);
  if (seeded?.harness !== harness) return;
  const granted = await deps.repo.agentConnections(deps.owner, agentId);
  if (granted.some((c) => c.templateId === seeded.providerTemplate))
    await deps.repo.bindChatProfile(deps.owner, agentId, seeded.id);
}

export function createProfilesService(
  deps: OwnerDeps & {
    agentBinding: readonly string[] | "*";
    resolve: ProfileResolver;
    /* UNIT_BOUNDARY_DESCRIPTION: sends an agent that points at an edited profile its new pair, or answers why it cannot take it. */
    republish: (agentId: string) => Promise<string | null>;
  },
): ProfilesService {
  const { repo, owner, catalog } = deps;
  const agentIds = deps.agentBinding === "*" ? undefined : deps.agentBinding;

  function validate(
    profile: Pick<ProfileRow, "harness" | "providerTemplate" | "model">,
  ): void {
    const { harness, providerTemplate, model } = profile;
    const type = providerTypeForTemplateId(providerTemplate);
    const alias = parseQualifiedModel(model, { claudePrefix: true })?.alias;
    const problem = !catalog.harnesses.some((h) => h.name === harness)
      ? `unknown harness ${harness}`
      : type === null || !PROVIDER_TEMPLATE_IDS.has(providerTemplate)
        ? `unknown provider ${providerTemplate}`
        : alias !== aliasForProviderType(type)
          ? `${model} is not a ${providerTemplate} model`
          : !harnessFits(catalog, harness, type, providerTemplate)
            ? `the ${harness} harness cannot run on ${providerTemplate}`
            : null;
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
      settings: row.settings,
      seeded: row.seed === SEEDED_DEFAULT,
      usage: {
        agents: refs.agents.filter(
          (a) => a.chat === row.id || a.platform === row.id,
        ).length,
        channels: refs.channels.filter((c) => c.profileId === row.id).length,
        schedules: refs.schedules.filter((s) => s.profileId === row.id).length,
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
      await seedDefault(deps);
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
      };
    },

    async create(input) {
      /* UNIT_BOUNDARY_DESCRIPTION: seeded first, so a user-made "Default" cannot take the seed's name. */
      await seedDefault(deps);
      validate(input);
      const row = await repo
        .insert(owner, {
          name: input.name,
          harness: input.harness,
          providerTemplate: input.providerTemplate,
          model: input.model,
          settings: input.settings ?? {},
        })
        .catch((err: unknown) => {
          throw duplicate(err, input.name);
        });
      return view(row, await repo.references(owner, agentIds, row.id));
    },

    async update({ id, agentId: _agentId, ...patch }) {
      const current = await owned(id);
      validate({ ...current, ...patch });
      await repo.update(owner, id, patch).catch((err: unknown) => {
        throw duplicate(err, patch.name ?? current.name);
      });
      const renameOnly = Object.keys(patch).every((key) => key === "name");
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
        const { name, harness, providerTemplate, model, settings } = current;
        await repo.update(owner, id, {
          name,
          harness,
          providerTemplate,
          model,
          settings,
        });
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `No agent can run this profile: ${rejected[0]!.reason}`,
        });
      }
      if (rejected.length > 0)
        getLogger().warn({ profileId: id, rejected }, "profile edit rejected");
      return view(await owned(id), await repo.references(owner, agentIds, id));
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
          ].join(", ")}.`,
        });
      }
    },
  };
}
