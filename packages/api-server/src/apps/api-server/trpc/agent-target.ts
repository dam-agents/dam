import type {
  AgentPermission,
  AgentTarget,
  ApprovalType,
} from "api-server-api";
import { match } from "ts-pattern";

export interface ResolvedTarget {
  agentId: string;
  needs: AgentPermission[];
}

const APPROVAL_NEEDS: Record<ApprovalType, AgentPermission | null> = {
  acp_native: "sessions",
  ext_authz: "egressRules",
  egress_proposal: "egressRules",
  spend_limit: null,
};

const onAgent = (agentId: string | undefined | null): ResolvedTarget | null =>
  agentId ? { agentId, needs: [] } : null;

/**
 * UNIT_BOUNDARY_DESCRIPTION: Which Agent a procedure's input acts on, for the
 * Agent Permission check. Some procedures name only a schedule, an Egress
 * Rule, an Environment or approvals, so the Agent is read from that record
 * without any owner scope. Records given together must all belong to one
 * Agent. An approval also needs the permission of what it lets through: a
 * tool call needs `sessions`, network access and a proposed rule need
 * `egressRules`. A spend limit question has no target, because continuing it
 * raises the owner's own spending. Null when a record is gone, records span
 * Agents or one has no target: the procedure then runs as the caller, and the
 * owner-scoped service answers as it always did.
 */
export function createAgentTargetResolver(deps: {
  schedules: { getById(id: string): Promise<{ agentId: string } | null> };
  egressRules: { getById(id: string): Promise<{ agentId: string } | null> };
  environments: {
    get(id: string): Promise<{ owningAgentId: string } | null>;
  };
  approvals: {
    getPending(
      id: string,
    ): Promise<{ agentId: string; type: ApprovalType } | null>;
  };
}): (target: AgentTarget) => Promise<ResolvedTarget | null> {
  const oneAgent = (agentIds: readonly (string | undefined)[]) => {
    const [agentId, ...rest] = [...new Set(agentIds)];
    return rest.length === 0 ? agentId : undefined;
  };
  return (target) =>
    match(target)
      .with({ kind: "agent" }, ({ agentId }) =>
        Promise.resolve(onAgent(agentId)),
      )
      .with({ kind: "schedules" }, async ({ scheduleIds }) =>
        onAgent(
          oneAgent(
            await Promise.all(
              scheduleIds.map(
                async (id) => (await deps.schedules.getById(id))?.agentId,
              ),
            ),
          ),
        ),
      )
      .with({ kind: "egressRule" }, async ({ ruleId }) =>
        onAgent((await deps.egressRules.getById(ruleId))?.agentId),
      )
      .with({ kind: "environment" }, async ({ environmentId }) =>
        onAgent((await deps.environments.get(environmentId))?.owningAgentId),
      )
      .with({ kind: "approvals" }, async ({ approvalIds }) => {
        const rows = await Promise.all(
          approvalIds.map((id) => deps.approvals.getPending(id)),
        );
        const agentId = oneAgent(rows.map((row) => row?.agentId));
        const needs = rows.map((row) => row && APPROVAL_NEEDS[row.type]);
        if (!agentId || needs.some((need) => !need)) return null;
        return {
          agentId,
          needs: [...new Set(needs as AgentPermission[])],
        };
      })
      .exhaustive();
}
