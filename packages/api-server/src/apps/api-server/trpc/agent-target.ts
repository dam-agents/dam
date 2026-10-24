import type { AgentTarget } from "api-server-api";
import { match } from "ts-pattern";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Which Agent a procedure's input acts on, for the
 * Agent Permission check. Some procedures name only a schedule, an Egress Rule
 * or an Environment, so the Agent is read from that record without any owner
 * scope. Schedules given together must all belong to one Agent. Null when the
 * record is gone or the schedules span Agents: the procedure then runs as the
 * caller, and the owner-scoped service answers as it always did.
 */
export function createAgentTargetResolver(deps: {
  schedules: { getById(id: string): Promise<{ agentId: string } | null> };
  egressRules: { getById(id: string): Promise<{ agentId: string } | null> };
  environments: {
    get(id: string): Promise<{ owningAgentId: string } | null>;
  };
}): (target: AgentTarget) => Promise<string | null> {
  return (target) =>
    match(target)
      .with({ kind: "agent" }, ({ agentId }) => Promise.resolve(agentId))
      .with({ kind: "schedules" }, async ({ scheduleIds }) => {
        const agentIds = new Set(
          await Promise.all(
            scheduleIds.map(
              async (id) => (await deps.schedules.getById(id))?.agentId,
            ),
          ),
        );
        const [agentId, ...rest] = [...agentIds];
        return agentId !== undefined && rest.length === 0 ? agentId : null;
      })
      .with(
        { kind: "egressRule" },
        async ({ ruleId }) =>
          (await deps.egressRules.getById(ruleId))?.agentId ?? null,
      )
      .with(
        { kind: "environment" },
        async ({ environmentId }) =>
          (await deps.environments.get(environmentId))?.owningAgentId ?? null,
      )
      .exhaustive();
}
