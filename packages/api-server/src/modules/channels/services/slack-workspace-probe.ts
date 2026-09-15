import {
  ORIGINAL_WORKSPACE,
  type SlackWorkspace,
} from "../infrastructure/slack-gateway.js";

export type SlackWorkspaceResolution =
  | { kind: "resolved"; teamId: SlackWorkspace }
  | { kind: "ambiguous"; teamIds: SlackWorkspace[] };

export interface SlackWorkspaceProbeDeps {
  listInstalledWorkspaces: () => Promise<SlackWorkspace[]>;
  knowsConversation: (
    slackChannelId: string,
    teamId: SlackWorkspace,
  ) => Promise<boolean>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Which workspace a bare Slack conversation id
 * belongs to. A channel id is unique inside its workspace, not across them, so
 * once a second workspace is installed the id a person pastes into the UI or
 * passes to the CLI no longer says where it lives. Slack is asked rather than
 * the person: whichever installed workspace recognises the conversation owns
 * it. An id that several recognise, or none, is refused rather than guessed —
 * binding an Agent into the wrong workspace would lend it to strangers.
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

    const found: SlackWorkspace[] = [];
    for (const teamId of candidates) {
      if (
        await deps.knowsConversation(slackChannelId, teamId).catch(() => false)
      )
        found.push(teamId);
    }
    return found.length === 1
      ? { kind: "resolved", teamId: found[0]! }
      : { kind: "ambiguous", teamIds: found };
  };
}
