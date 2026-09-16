import {
  ORIGINAL_WORKSPACE,
  type SlackWorkspace,
} from "../infrastructure/slack-gateway.js";

export type SlackConversationStanding = "member" | "known" | "unknown";

export type SlackWorkspaceResolution =
  | { kind: "resolved"; teamId: SlackWorkspace }
  | { kind: "unknown" };

export interface SlackWorkspaceProbeDeps {
  listInstalledWorkspaces: () => Promise<SlackWorkspace[]>;
  standingIn: (
    slackChannelId: string,
    teamId: SlackWorkspace,
  ) => Promise<SlackConversationStanding>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Which workspace a bare Slack conversation id
 * belongs to. The person pasting the id was standing in a workspace when they
 * copied it; the bind surface simply does not carry that, so Slack is asked
 * instead of the person.
 *
 * Several connected workspaces answering yes is normal, not a conflict: an
 * enterprise organization shares one channel into many of its workspaces, and
 * each is looking at the same conversation, so either token posts to the same
 * place. Membership is what separates them — a workspace the bot was invited
 * to can post, one that merely sees the channel cannot — and among equals the
 * original workspace wins so the answer is stable across binds. Only a
 * conversation no connected workspace can see is refused.
 *
 * The install that predates multi-workspace support is the empty workspace,
 * and while it is the only one no call is made at all: a single-workspace
 * install answers without ever asking Slack.
 */
export function createSlackWorkspaceProbe(deps: SlackWorkspaceProbeDeps) {
  return async (slackChannelId: string): Promise<SlackWorkspaceResolution> => {
    const installed = await deps.listInstalledWorkspaces();
    const candidates = [ORIGINAL_WORKSPACE, ...installed];
    if (candidates.length === 1) {
      return { kind: "resolved", teamId: ORIGINAL_WORKSPACE };
    }

    const members: SlackWorkspace[] = [];
    const seers: SlackWorkspace[] = [];
    for (const teamId of candidates) {
      const standing = await deps
        .standingIn(slackChannelId, teamId)
        .catch((): SlackConversationStanding => "unknown");
      if (standing === "member") members.push(teamId);
      else if (standing === "known") seers.push(teamId);
    }
    const chosen = members[0] ?? seers[0];
    return chosen === undefined
      ? { kind: "unknown" }
      : { kind: "resolved", teamId: chosen };
  };
}
