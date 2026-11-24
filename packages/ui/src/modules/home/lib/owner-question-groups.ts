import type { OwnerQuestionNotice } from "api-server-api";

// UNIT_BOUNDARY_DESCRIPTION: waiting questions as the bell tells them: one group per Agent whose sub-agents ask, oldest question first, so an Agent with many asking sub-agents is one thing that needs the owner, not many.
export function ownerQuestionGroups(
  notices: readonly OwnerQuestionNotice[],
): OwnerQuestionNotice[][] {
  const byAgent = new Map<string, OwnerQuestionNotice[]>();
  const oldestFirst = [...notices].sort(
    (a, b) => Date.parse(a.askedAt) - Date.parse(b.askedAt),
  );
  for (const notice of oldestFirst)
    byAgent.set(notice.agentId, [
      ...(byAgent.get(notice.agentId) ?? []),
      notice,
    ]);
  return [...byAgent.values()];
}
