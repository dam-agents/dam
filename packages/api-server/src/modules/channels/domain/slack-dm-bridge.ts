import type { SlackEmailUser } from "../infrastructure/slack-gateway.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Why a Slack account found by mailbox cannot stand
 * for the owner, in the words the caller reports. Every one of them is a
 * refusal: a pairing that needs a guess is not made.
 */
export type SlackDmRefusal =
  | "email-mismatch"
  | "deleted"
  | "bot"
  | "app-user"
  | "guest"
  | "external"
  | "other-workspace";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The mailbox has to be the account's own and the
 * account has to be an ordinary member of the workspace the operator trusts —
 * a guest, a Slack Connect or Grid stranger, a bot, an app or a person from
 * another team all share an address with nobody we mean, and a paid plan lets
 * an admin set a member's address without verification.
 */
export function acceptEmailMatch(
  user: SlackEmailUser,
  verifiedEmail: string,
  workspaceTeamId: string,
): SlackDmRefusal | null {
  if (!user.email || user.email.toLowerCase() !== verifiedEmail.toLowerCase())
    return "email-mismatch";
  if (user.deleted) return "deleted";
  if (user.isBot) return "bot";
  if (user.isAppUser) return "app-user";
  if (user.isRestricted || user.isUltraRestricted) return "guest";
  if (user.isStranger) return "external";
  if (user.teamId !== workspaceTeamId) return "other-workspace";
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
 * that a message here can operate their account.
 */
export function slackDmHello(args: {
  agentName: string;
  brandShort: string;
  purpose?: string | undefined;
  isDefault: boolean;
}): string {
  const { agentName, brandShort, purpose, isDefault } = args;
  return [
    `Hi, I'm ${agentName} from ${brandShort}.`,
    `I'll send you ${purpose && purpose.trim() ? purpose.trim() : "your results"} here, and you can message me here anytime.`,
    `Messages here can ask me to act on your ${brandShort} account.`,
    `Not you, or want to stop? Type \`/${brandShort} unbind\` here.`,
    ...(isDefault ? [] : [`Start a message with ${agentName} to reach me.`]),
  ].join(" ");
}
