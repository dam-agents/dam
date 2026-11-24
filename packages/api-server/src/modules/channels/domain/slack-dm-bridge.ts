import type {
  SlackEmailUser,
  SlackWorkspaceIdentity,
} from "../infrastructure/slack-gateway.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Why a Slack account found by mailbox cannot stand
 * for the owner, in the words the caller reports. Every one of them is a
 * refusal: a pairing that needs a guess is not made.
 */
export type SlackDmRefusal =
  | "email-mismatch"
  | "other-workspace"
  | "unknown-enterprise"
  | "other-enterprise"
  | "deleted"
  | "bot"
  | "app-user"
  | "guest"
  | "external";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The mailbox has to be the account's own, and the
 * account has to be an ordinary member of the workspace the operator trusts —
 * a guest, a Slack Connect or Grid stranger, a bot, an app, or a person from
 * another team or organization shares an address with nobody we mean, and a
 * paid plan lets an admin set a member's address without verification.
 *
 * Membership is Slack's own attribution plus, on an enterprise, the workspaces
 * the organization says the person belongs to; neither is ever inferred from
 * the workspace the lookup asked about. The organization the install recorded
 * and the one Slack reports must agree — when either is missing the pairing
 * refuses, because a mismatch it cannot see is a stranger it would accept.
 */
export function acceptEmailMatch(
  user: SlackEmailUser,
  verifiedEmail: string,
  workspace: SlackWorkspaceIdentity,
): SlackDmRefusal | null {
  if (user.email.toLowerCase() !== verifiedEmail.toLowerCase())
    return "email-mismatch";
  const memberOfWorkspace =
    user.teamId === workspace.teamId ||
    (user.enterpriseTeams?.includes(workspace.teamId) ?? false);
  if (!memberOfWorkspace) return "other-workspace";
  if (workspace.enterpriseId === null) return "unknown-enterprise";
  /* UNIT_BOUNDARY_DESCRIPTION: a standalone workspace records the empty string
   * and a person Slack places in no organization reports none, so those two are
   * the same fact; any other pairing of the two is a mismatch. */
  if ((user.enterpriseId ?? "") !== workspace.enterpriseId)
    return "other-enterprise";
  if (user.deleted) return "deleted";
  if (user.isBot) return "bot";
  if (user.isAppUser) return "app-user";
  if (user.isRestricted || user.isUltraRestricted) return "guest";
  if (user.isStranger === true || user.enterpriseIsGuest === true)
    return "external";
  return null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: A 1:1 DM is the whole authorisation for driving
 * the Agent, so a conversation that only looks direct is refused: a group DM
 * has members nobody paired, and a DM with somebody else is not the owner's.
 */
export function acceptDirectMessage(
  info: {
    isDirectMessage: boolean;
    isGroupDirectMessage: boolean;
    directMessageUser: string | null;
  },
  slackUserId: string,
): "not-a-dm" | "dm-with-someone-else" | null {
  if (info.isGroupDirectMessage) return "not-a-dm";
  if (!info.isDirectMessage) return "not-a-dm";
  if (info.directMessageUser !== slackUserId) return "dm-with-someone-else";
  return null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: What the Bridge needs granted before it promises
 * anything: it finds the person by mailbox, opens the DM, reads replies there
 * and writes the hello. An unknown grant set is not a grant — a workspace whose
 * answer Slack did not give counts as not ready.
 */
export const SLACK_DM_REQUIRED_SCOPES = [
  "users:read",
  "users:read.email",
  "im:read",
  "im:write",
  "im:history",
  "chat:write",
] as const;

export function missingRequiredScopes(
  granted: readonly string[] | null,
): string[] {
  if (granted === null) return [...SLACK_DM_REQUIRED_SCOPES];
  const have = new Set(granted);
  return SLACK_DM_REQUIRED_SCOPES.filter((scope) => !have.has(scope));
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The DM's hello names the agent, what it sends, the
 * reach the pairing grants, and how to undo it — the one place the owner reads
 * that a message here can operate their account. Where another Agent is bound
 * to the same DM the bare command would be refused as ambiguous, so the hint
 * names this one.
 */
export function slackDmHello(args: {
  agentName: string;
  brandShort: string;
  purpose?: string | undefined;
  isDefault: boolean;
  otherAgentsBound: boolean;
}): string {
  const { agentName, brandShort, purpose, isDefault, otherAgentsBound } = args;
  const unbind = otherAgentsBound
    ? `/${brandShort} unbind ${agentName}`
    : `/${brandShort} unbind`;
  return [
    `Hi, I'm ${agentName} from ${brandShort}.`,
    `I'll send you ${purpose && purpose.trim() ? purpose.trim() : "your results"} here, and you can message me here anytime.`,
    `You can ask me about your results here. To change what I do, ask me in ${brandShort}.`,
    `Not you, or want to stop? Type \`${unbind}\` here.`,
    ...(isDefault ? [] : [`Start a message with ${agentName} to reach me.`]),
  ].join(" ");
}
