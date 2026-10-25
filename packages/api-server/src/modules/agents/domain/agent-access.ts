export type AgentRole = "owner" | "editor";

/**
 * UNIT_BOUNDARY_DESCRIPTION: How a person stands to one Agent. The owner is
 * the person the Agent belongs to. An Agent Editor is anyone else whose
 * verified email is on the Agent's Editor List. Everyone else has no access,
 * so the Agent is not found for them.
 */
export function accessTo(
  agentOwner: string | undefined,
  editors: readonly string[],
  caller: { sub: string; editorEmail: string | null },
): AgentRole | null {
  if (agentOwner !== undefined && agentOwner === caller.sub) return "owner";
  if (caller.editorEmail !== null && editors.includes(caller.editorEmail))
    return "editor";
  return null;
}

export function namesOwner(
  editors: readonly string[],
  ownerEmails: readonly (string | null)[],
): boolean {
  return ownerEmails.some((email) => email !== null && editors.includes(email));
}
