import type { SkillSource } from "api-server-api";
import type { AgentService } from "../../agent/index.js";
import { resolveAgentOrExit } from "../../agent/commands/errors.js";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { EXIT_INVALID_INPUT } from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { resolveSourceRef } from "../domain/source-ref.js";
import type { SkillsService } from "../services/skills-service.js";

export type SkillCommandDeps = {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
  createSkillsService: (host: string) => SkillsService;
};

/** UNIT_BOUNDARY_DESCRIPTION: what a skill command that names an Agent and one of its registered sources needs before it can act — the host, the Agent's id, the skills service and the resolved source — resolving each one the same way and exiting on the same messages and codes, so install, uninstall and publish differ only in what they do once they have them. */
export async function resolveSkillTarget(
  deps: SkillCommandDeps,
  agentRef: string,
  sourceRef: string,
  server: string | undefined,
): Promise<{
  host: string;
  agentId: string;
  svc: SkillsService;
  source: SkillSource;
}> {
  const host = await resolveActiveHost(deps, server);
  const agent = await resolveAgentOrExit(
    deps.createAgentService(host),
    agentRef,
    host,
  );
  const agentId = agent.id;
  const svc = deps.createSkillsService(host);
  const sourcesRes = await svc.listSources(agentId);
  exitOnServiceError(sourcesRes, host);
  const source = resolveSourceRef(sourcesRes.value, sourceRef);
  if (!source) {
    process.stderr.write(
      `error: no registered skill source with id or url '${sourceRef}'\n`,
    );
    process.stderr.write(
      "hint: run `dam skill source list` to see registered sources\n",
    );
    process.exit(EXIT_INVALID_INPUT);
  }
  return { host, agentId, svc, source };
}
