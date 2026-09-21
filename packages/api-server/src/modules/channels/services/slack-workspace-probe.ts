import {
  ORIGINAL_WORKSPACE,
  type SlackWorkspace,
} from "../infrastructure/slack-gateway.js";

export type SlackConversationStanding = "member" | "known" | "unknown";

export type SlackWorkspaceResolution =
  | { kind: "resolved"; teamId: SlackWorkspace }
  | { kind: "unknown" }
  | { kind: "unreachable" };

export interface SlackWorkspaceProbeDeps {
  listInstalledWorkspaces: () => Promise<SlackWorkspace[]>;
  conversationStanding: (
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
 * conversation no connected workspace can see is refused — and that refusal is
 * reported apart from the case where nothing could be asked at all, because a
 * workspace withheld the scope the question needs or Slack did not answer.
 * Reading those two the same way tells an operator to check a conversation id
 * that was right all along. One workspace failing is not that case: as long as
 * something answered, the answer stands, or one permanently broken workspace
 * would turn every wrong id into "try again".
 *
 * Every workspace is asked at once, not one after another. The order the
 * replies arrive in does not change the answer, and the question travels to the
 * one replica holding the Slack connection, so asking in turn would make a
 * single bind wait out every workspace that cannot reply. That wait also splits
 * the question in time: workspaces asked late could answer while the early ones
 * had already given up, which reads as a definite no from workspaces nobody
 * heard from.
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

    const asked = await Promise.allSettled(
      candidates.map(async (teamId) => ({
        teamId,
        standing: await deps.conversationStanding(slackChannelId, teamId),
      })),
    );

    const members: SlackWorkspace[] = [];
    const seers: SlackWorkspace[] = [];
    let answered = 0;
    for (const asking of asked) {
      if (asking.status === "rejected") continue;
      answered += 1;
      if (asking.value.standing === "member") members.push(asking.value.teamId);
      else if (asking.value.standing === "known")
        seers.push(asking.value.teamId);
    }
    const chosen = members[0] ?? seers[0];
    if (chosen !== undefined) return { kind: "resolved", teamId: chosen };
    return answered === 0 ? { kind: "unreachable" } : { kind: "unknown" };
  };
}
