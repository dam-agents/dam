import { TRPCError } from "@trpc/server";
import type {
  SkillPublishInput,
  SkillPublishResult,
  SkillPublishRecord,
  SkillSource,
} from "api-server-api";
import type { AgentsRepository } from "../../agents/infrastructure/agents-repository.js";
import type { AgentSkillsRepository } from "../infrastructure/agent-skills-repository.js";
import { ensureAgentReachable } from "./ensure-agent-reachable.js";
import {
  AgentRuntimeUpstreamError,
  type AgentRuntimeSkillsClient,
} from "../infrastructure/agent-runtime-client.js";
import { detectHost } from "../infrastructure/git-host.js";
import { upstreamToTrpc } from "../infrastructure/upstream-to-trpc.js";
import { securityLog } from "../../../core/security-log.js";

export interface PublishServiceDeps {
  owner: string;
  /** Look up a source by id. Must handle real ids (user / system) AND
   *  template-synthesised `template:*` ids — publishing is supposed to work
   *  against template-bound sources too. */
  resolveSource: (id: string) => Promise<SkillSource | null>;
  agentSkills: AgentSkillsRepository;
  agents: AgentsRepository;
  runtimeClient: AgentRuntimeSkillsClient;
  /** Display name surfaced in the auto-generated PR body when the caller
   *  doesn't pass one. Sourced from brand config (env-var driven). */
  brandName: string;
}

/**
 * Publish orchestrator — thin proxy. Validates that the user owns the
 * instance + source and wakes a hibernated agent, then delegates
 * everything else to agent-runtime (which goes through the in-pod Envoy
 * sidecar's credential injector for the GitHub token swap).
 *
 * Upstream gateway errors (app_not_connected / access_restricted) get
 * re-thrown as tRPC errors with the `connect_url` / `manage_url` carried
 * along in `message` so the UI can parse them.
 */
export async function publishSkill(
  deps: PublishServiceDeps,
  input: SkillPublishInput,
): Promise<SkillPublishResult> {
  const agent = await ensureAgentReachable(
    deps.agents,
    input.agentId,
    deps.owner,
  );

  const source = await deps.resolveSource(input.sourceId);
  if (!source)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "skill source not found",
    });

  const host = detectHost(source.gitUrl);
  if (!host) {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: `publishing to ${source.gitUrl} isn't supported yet (only GitHub)`,
    });
  }

  // Untouched image-shipped skills aren't the user's to publish (#2828) —
  // block them here rather than in the pod so the verdict is uniform across
  // callers (UI and MCP). A `system-modified` skill passes: the user changed
  // its content, so the divergence is theirs to publish. Pods predating
  // origin classification report no origin and stay publishable, matching
  // pre-provenance behavior.
  const local = await deps.runtimeClient.listLocal(input.agentId);
  if (local.find((s) => s.name === input.name)?.origin === "system") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `"${input.name}" is built into this sandbox's image and can't be published`,
    });
  }

  let result;
  try {
    result = await deps.runtimeClient.publish(input.agentId, {
      name: input.name,
      owner: host.owner,
      repo: host.repo,
      title: input.title?.trim() || `Add ${input.name} skill`,
      body:
        input.body?.trim() ||
        `Published from ${deps.brandName}.\n\n**Skill:** \`${input.name}\``,
      ...(source.path !== undefined ? { path: source.path } : {}),
    });
  } catch (err) {
    if (err instanceof AgentRuntimeUpstreamError) {
      throw upstreamToTrpc(err);
    }
    throw err;
  }

  // Explicit publish record. Drives the UI's Published badge + View PR link
  // so we don't fall back to a name-match heuristic that false-positives on
  // unrelated skills sharing a catalog entry's name. Source fields are
  // denormalized so the record survives source renames/deletions.
  const record: SkillPublishRecord = {
    skillName: input.name,
    sourceId: source.id,
    sourceName: source.name,
    sourceGitUrl: source.gitUrl,
    prUrl: result.prUrl,
    publishedAt: new Date().toISOString(),
  };
  await deps.agentSkills.appendPublish(input.agentId, record);

  // Credential-backed external write: the agent's injected GitHub PAT opens a
  // PR upstream on the owner's behalf.
  securityLog("info", "skill.publish", {
    category: "privileged",
    actor: deps.owner,
    actorKind: "user",
    agentId: input.agentId,
    target: source.gitUrl,
    result: "success",
    detail: {
      skill: input.name,
      repo: `${host.owner}/${host.repo}`,
      prUrl: result.prUrl,
    },
  });

  return result;
}
