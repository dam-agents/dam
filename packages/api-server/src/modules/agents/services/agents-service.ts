import {
  isProtectedAgentEnvName,
  type AgentsService,
  type CreateAgentInput,
  type EgressPreset,
  type UpdateAgentInput,
  type EnvVar,
  type TemplateSpec,
} from "api-server-api";
import { TRPCError } from "@trpc/server";
import type { AgentsRepository } from "../infrastructure/agents-repository.js";
import { assembleSpecFromTemplate, assembleSpecFromImage } from "../domain/spec-assembly.js";

/**
 * Port consumed by `create()` to seed `egress_rules` for a brand-new agent
 * (ADR-035). Declared locally so the agents module doesn't
 * import across module boundaries; the egress-rules module's adapter
 * structurally satisfies this shape.
 */
export interface PresetSeeder {
  seed(agentId: string, preset: EgressPreset, decidedBy: string): Promise<void>;
}

/**
 * Cleanup hook invoked after a successful K8s ConfigMap delete. Each
 * registered hook clears its module's per-agent durable state — egress
 * rules, pending approvals, anything else keyed by `agent_id` in
 * Postgres. Best-effort: a single hook failing logs and continues so a
 * partial delete doesn't strand the rest. Orphans that escape are caught
 * by the agent-artifacts sweeper saga.
 */
export type AgentCleanupHook = (agentId: string) => Promise<void>;

/**
 * Returns a new env list where any platform-managed entries (e.g. PORT) are
 * taken from `current` rather than `incoming`, preventing clients from
 * clobbering template-owned envs.
 */
function preserveProtectedEnvs(current: EnvVar[], incoming: EnvVar[]): EnvVar[] {
  const preserved = current.filter((e) => isProtectedAgentEnvName(e.name));
  const user = incoming.filter((e) => !isProtectedAgentEnvName(e.name));
  return [...preserved, ...user];
}

export function createAgentsService(deps: {
  repo: AgentsRepository;
  owner: string;
  readTemplateSpec: (id: string) => Promise<{ spec: TemplateSpec; isOwned: boolean } | null>;
  /** Seeds egress_rules at create time. Optional so the system-instances
   *  composition (which never creates agents) can omit it. */
  presetSeeder?: PresetSeeder;
  /** Run after a successful K8s delete. Each module that owns per-agent
   *  Postgres state contributes one hook; the wiring layer composes the
   *  list. Empty / undefined is fine — no cleanup, orphans rely on the
   *  background sweeper. */
  cleanupHooks?: readonly AgentCleanupHook[];
}): AgentsService {
  return {
    list: () => deps.repo.list(deps.owner),
    get: (id) => deps.repo.get(id, deps.owner),

    async create(input: CreateAgentInput) {
      let spec: Record<string, unknown>;
      let templateId: string | undefined;
      if (input.templateId) {
        const tmpl = await deps.readTemplateSpec(input.templateId);
        if (!tmpl || tmpl.isOwned) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `template "${input.templateId}" not found`,
          });
        }
        spec = assembleSpecFromTemplate(input.name, tmpl.spec, {
          description: input.description,
        });
        templateId = input.templateId;
      } else {
        spec = assembleSpecFromImage(input.name, {
          image: input.image,
          description: input.description,
        });
      }
      // Append caller-supplied extras (e.g. envMappings from granted app
      // connections). `preserveProtectedEnvs` ensures PORT is always sourced
      // from the template/defaults, no matter what the caller sends.
      if (input.env?.length) {
        const base = (spec.env as EnvVar[] | undefined) ?? [];
        spec.env = preserveProtectedEnvs(base, [...base, ...input.env]);
      }
      const agent = await deps.repo.create(spec, deps.owner, templateId);
      // Bulk-seed the requested preset (default `trusted`). `none` is a
      // no-op; the trusted host list is captured at boot, so reseeding on
      // retry is idempotent against the lookup index. The chosen preset is
      // not stored on the spec — the seeded rows' `source` is the truth.
      if (deps.presetSeeder) {
        await deps.presetSeeder.seed(agent.id, input.egressPreset ?? "trusted", deps.owner);
      }
      return agent;
    },

    async update(input: UpdateAgentInput) {
      let env = input.env;
      if (env !== undefined) {
        const current = await deps.repo.get(input.id, deps.owner);
        env = preserveProtectedEnvs(current?.spec.env ?? [], env);
      }
      return deps.repo.updateSpec(input.id, deps.owner, {
        name: input.name,
        description: input.description,
        env,
      });
    },

    async delete(id) {
      await deps.repo.delete(id, deps.owner);
      // Run cleanup hooks sequentially. Each hook is best-effort: a thrown
      // hook is logged and skipped so a single module's failure doesn't
      // strand the others. The sweeper saga catches anything missed here.
      for (const hook of deps.cleanupHooks ?? []) {
        try {
          await hook(id);
        } catch (err) {
          process.stderr.write(
            `agents.delete cleanup hook failed for ${id}: ${err instanceof Error ? err.message : err}\n`,
          );
        }
      }
    },
  };
}
