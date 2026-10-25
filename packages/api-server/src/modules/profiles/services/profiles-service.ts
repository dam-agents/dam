import { isUniqueViolation } from "../../../core/db-errors.js";
import { TRPCError } from "@trpc/server";
import {
  aliasForProviderType,
  harnessFits,
  parseQualifiedModel,
  PROVIDER_TEMPLATE_IDS,
  providerTypeForTemplateId,
  type HarnessCatalog,
  type ProfileCreateInput,
  type ProfileUpdateInput,
  type ProfileUsage,
  type ProfileWithUsage,
  type ProfilesService,
} from "api-server-api";
import { PLATFORM_SUBAGENT_PREFIX } from "agent-runtime-api";
import {
  SEEDED_DEFAULT,
  type ProfileRow,
  type ProfilesRepository,
} from "../infrastructure/profiles-repository.js";

/** UNIT_BOUNDARY_DESCRIPTION: what the deployment's shared provider is, when it has one, so the seeded profile names a provider and a model the install actually serves. */
export interface SeededProvider {
  providerTemplate: string;
  model: string;
}

export interface ProfilesServiceDeps {
  repo: ProfilesRepository;
  owner: string;
  /* UNIT_BOUNDARY_DESCRIPTION: a key limited to some agents sees usage of those agents only. */
  agentBinding?: readonly string[] | "*";
  catalog: Pick<HarnessCatalog, "default" | "harnesses">;
  seededProvider: SeededProvider | null;
}

export function createProfilesService(
  deps: ProfilesServiceDeps,
): ProfilesService {
  const { repo, owner, catalog } = deps;
  const binding = () =>
    deps.agentBinding === undefined || deps.agentBinding === "*"
      ? undefined
      : deps.agentBinding;

  function validate(profile: {
    harness: string;
    providerTemplate: string;
    model: string;
  }): void {
    const { harness, providerTemplate, model } = profile;
    if (!catalog.harnesses.some((h) => h.name === harness))
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `unknown harness ${harness}`,
      });
    const type = providerTypeForTemplateId(providerTemplate);
    if (type === null || !PROVIDER_TEMPLATE_IDS.has(providerTemplate))
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `unknown provider ${providerTemplate}`,
      });
    const parsed = parseQualifiedModel(model, { claudePrefix: true });
    if (parsed === null)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `name the model with its provider, as <provider>/${model}`,
      });
    if (parsed.alias !== aliasForProviderType(type))
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `${model} is not a ${providerTemplate} model`,
      });
    if (!harnessFits(catalog, harness, type, providerTemplate))
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `the ${harness} harness cannot run on ${providerTemplate}`,
      });
  }

  /* UNIT_BOUNDARY_DESCRIPTION: a profile holds the session settings its harness
   * keeps for a session, and never the platform sub-agent slot, whose reference
   * lives on the agent (plan §a). A value the owner can see is refused here, as
   * the model and the harness are; whether a harness offers a value needs that
   * harness's live catalog, which is an agent's, so it is checked where the
   * profile is used. */
  function validateSettings(
    settings: Record<string, string> | undefined,
  ): void {
    for (const [id, value] of Object.entries(settings ?? {})) {
      if (id.startsWith(PLATFORM_SUBAGENT_PREFIX))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `a profile cannot hold ${id}; the platform sub-agent slot belongs to the agent`,
        });
      if (value.trim() === "")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${id} needs a value`,
        });
    }
  }

  async function view(id: string): Promise<ProfileWithUsage> {
    const row = await repo.get(owner, id);
    if (!row)
      throw new TRPCError({ code: "NOT_FOUND", message: "profile not found" });
    const usage = await repo.usage(owner, id, binding());
    return withUsage(row, usage);
  }

  async function ensureDefault(): Promise<void> {
    const seeded = deps.seededProvider;
    /* UNIT_BOUNDARY_DESCRIPTION: an install that serves no shared provider has
     * nothing to write, so it claims no marker either — the marker is what says
     * "this owner has had their seeded Default", and an owner who configures
     * the shared provider later still gets one. */
    if (seeded === null) return;
    await repo.seed(owner, {
      name: "Default",
      harness: catalog.default,
      providerTemplate: seeded.providerTemplate,
      model: seeded.model,
      settings: {},
    });
  }

  return {
    async list() {
      await ensureDefault();
      const [rows, counts] = await Promise.all([
        repo.list(owner),
        repo.usageCounts(owner, binding()),
      ]);
      return rows.map((row) => {
        const countsFor = counts.get(row.id) ?? {
          agents: 0,
          channels: 0,
          schedules: 0,
        };
        return {
          id: row.id,
          name: row.name,
          harness: row.harness,
          providerTemplate: row.providerTemplate,
          model: row.model,
          settings: row.settings,
          seeded: row.seed === SEEDED_DEFAULT,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
          usage: countsFor,
        };
      });
    },

    async usage(id: string) {
      if (!(await repo.get(owner, id)))
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "profile not found",
        });
      return repo.usage(owner, id, binding());
    },

    async create(input: ProfileCreateInput) {
      /* UNIT_BOUNDARY_DESCRIPTION: seed first, so an owner who names a profile
       * "Default" before their first list cannot swallow the seeded one. */
      await ensureDefault();
      validate(input);
      validateSettings(input.settings);
      try {
        const row = await repo.insert(owner, {
          name: input.name,
          harness: input.harness,
          providerTemplate: input.providerTemplate,
          model: input.model,
          settings: input.settings ?? {},
        });
        return view(row.id);
      } catch (err) {
        if (isUniqueViolation(err)) throw duplicateName(input.name);
        throw err;
      }
    },

    async update(input: ProfileUpdateInput) {
      const current = await repo.get(owner, input.id);
      if (!current)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "profile not found",
        });
      validate({
        harness: input.harness ?? current.harness,
        providerTemplate: input.providerTemplate ?? current.providerTemplate,
        model: input.model ?? current.model,
      });
      validateSettings(input.settings);
      try {
        await repo.update(owner, input.id, {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.harness !== undefined && { harness: input.harness }),
          ...(input.providerTemplate !== undefined && {
            providerTemplate: input.providerTemplate,
          }),
          ...(input.model !== undefined && { model: input.model }),
          ...(input.settings !== undefined && { settings: input.settings }),
        });
      } catch (err) {
        if (isUniqueViolation(err))
          throw duplicateName(input.name ?? current.name);
        throw err;
      }
      return view(input.id);
    },

    async delete(id: string) {
      const outcome = await repo.deleteIfUnused(owner, id, binding());
      if (outcome.outcome === "missing")
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "profile not found",
        });
      if (outcome.outcome === "in-use")
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `that profile is in use by ${inUse(outcome.usage)}`,
        });
    },
  };
}

function withUsage(row: ProfileRow, usage: ProfileUsage): ProfileWithUsage {
  return {
    id: row.id,
    name: row.name,
    harness: row.harness,
    providerTemplate: row.providerTemplate,
    model: row.model,
    settings: row.settings,
    seeded: row.seed === SEEDED_DEFAULT,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    usage: {
      agents: usage.agents.length,
      channels: usage.channels.length,
      schedules: usage.schedules.length,
    },
  };
}

function duplicateName(name: string): TRPCError {
  return new TRPCError({
    code: "CONFLICT",
    message: `a profile named ${name} already exists`,
  });
}

function inUse(usage: ProfileUsage): string {
  const parts = [
    ...(usage.agents.length > 0
      ? [`${usage.agents.length} agent${plural(usage.agents.length)}`]
      : []),
    ...(usage.channels.length > 0
      ? [`${usage.channels.length} channel${plural(usage.channels.length)}`]
      : []),
    ...(usage.schedules.length > 0
      ? [`${usage.schedules.length} schedule${plural(usage.schedules.length)}`]
      : []),
  ];
  return parts.join(", ");
}

const plural = (n: number) => (n === 1 ? "" : "s");
