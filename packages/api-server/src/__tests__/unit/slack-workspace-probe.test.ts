import { describe, it, expect } from "vitest";
import {
  createSlackWorkspaceProbe,
  type SlackConversationStanding,
} from "../../modules/channels/services/slack-workspace-probe.js";

/**
 * TEST_OVERVIEW: Which Slack workspace a bare conversation id belongs to. The
 * person pasting the id was standing in a workspace when they copied it; the
 * bind surface does not carry that, so Slack is asked instead of the person.
 * Several workspaces answering yes is normal — an enterprise organization
 * shares one channel into many of its workspaces — so membership picks the
 * winner and only a conversation nobody can see is refused.
 */

const NEVER_ASKED = async (): Promise<SlackConversationStanding> => {
  throw new Error("Slack was asked about a conversation it need not be");
};

describe("slack workspace probe", () => {
  /**
   * TEST_SCENARIO: One workspace is connected, so the answer is that one and
   * Slack is never called — a single-workspace install must not pay for a
   * feature it does not use.
   */
  it("answers for a lone install without asking Slack", async () => {
    const probe = createSlackWorkspaceProbe({
      listInstalledWorkspaces: async () => ["T1"],
      conversationStanding: NEVER_ASKED,
    });

    expect(await probe("C1")).toEqual({ kind: "resolved", teamId: "T1" });
  });

  /**
   * TEST_SCENARIO: A second workspace is installed and only it can see the
   * conversation. That is the whole point of the probe — the id resolves to the
   * workspace that has it, not to the one connected first.
   */
  it("resolves to the installed workspace that has the conversation", async () => {
    const probe = createSlackWorkspaceProbe({
      listInstalledWorkspaces: async () => ["T1", "T2"],
      conversationStanding: async (_channel: string, teamId: string) =>
        teamId === "T2" ? "member" : "unknown",
    });

    expect(await probe("C1")).toEqual({ kind: "resolved", teamId: "T2" });
  });

  /**
   * TEST_SCENARIO: No workspace is connected at all, so no conversation can
   * belong to one, and nothing is asked.
   */
  it("refuses every conversation while no workspace is connected", async () => {
    const probe = createSlackWorkspaceProbe({
      listInstalledWorkspaces: async () => [],
      conversationStanding: NEVER_ASKED,
    });

    expect(await probe("C1")).toEqual({ kind: "unknown" });
  });

  /**
   * TEST_SCENARIO: An organization shares one channel into several of its
   * workspaces, so more than one answers yes. They are looking at the same
   * conversation and either token posts to the same place, so this is settled
   * rather than refused — on the workspace connected first, so repeated binds of the
   * same conversation always land on the same answer.
   */
  it("settles a conversation shared into several workspaces", async () => {
    const probe = createSlackWorkspaceProbe({
      listInstalledWorkspaces: async () => ["T1", "T2", "T3"],
      conversationStanding: async () => "member" as const,
    });

    expect(await probe("C1")).toEqual({ kind: "resolved", teamId: "T1" });
  });

  /**
   * TEST_SCENARIO: A workspace that can only see the channel cannot post into
   * it, so it loses to one the bot was actually invited to — even though the
   * seer was connected first and would otherwise win.
   */
  it("prefers a workspace the bot belongs to over one that only sees it", async () => {
    const probe = createSlackWorkspaceProbe({
      listInstalledWorkspaces: async () => ["T1", "T2"],
      conversationStanding: async (_channel: string, teamId: string) =>
        teamId === "T2" ? "member" : "known",
    });

    expect(await probe("C1")).toEqual({ kind: "resolved", teamId: "T2" });
  });

  /**
   * TEST_SCENARIO: Nobody can see the id — a typo, or a private channel the bot
   * was never invited to. This is the only refusal, because it is the only case
   * where no workspace could serve the binding.
   */
  it("refuses a conversation no workspace can see", async () => {
    const probe = createSlackWorkspaceProbe({
      listInstalledWorkspaces: async () => ["T1", "T2"],
      conversationStanding: async () => "unknown" as const,
    });

    expect(await probe("C1")).toEqual({ kind: "unknown" });
  });

  /**
   * TEST_SCENARIO: One workspace's token is rejected or the call fails. A
   * workspace that cannot answer is not a workspace that said yes, so the
   * healthy one still resolves and a transient failure does not block a bind.
   */
  it("treats a workspace that cannot answer as not having it", async () => {
    const probe = createSlackWorkspaceProbe({
      listInstalledWorkspaces: async () => ["T1", "T2"],
      conversationStanding: async (
        _channel: string,
        teamId: string,
      ): Promise<SlackConversationStanding> => {
        if (teamId === "T1") throw new Error("invalid_auth");
        return "member";
      },
    });

    expect(await probe("C1")).toEqual({ kind: "resolved", teamId: "T2" });
  });

  /**
   * TEST_SCENARIO: No workspace could be asked at all — every one withheld the
   * scope the question needs, or Slack is down. That is not the same answer as
   * "nobody can see it": reading them alike tells the operator to check a
   * conversation id that was right all along, so the two are reported apart.
   */
  it("separates being unable to ask from nobody being able to see it", async () => {
    const probe = createSlackWorkspaceProbe({
      listInstalledWorkspaces: async () => ["T1", "T2"],
      conversationStanding: async () => {
        throw new Error("missing_scope");
      },
    });

    expect(await probe("C1")).toEqual({ kind: "unreachable" });
  });

  /**
   * TEST_SCENARIO: A genuinely wrong conversation id, while one workspace
   * permanently withholds the scope the question needs. The workspaces that
   * could answer all said no, so that is the answer — otherwise one broken
   * workspace would turn every typo into a retryable "try again" forever.
   */
  it("keeps a definite answer when only one workspace cannot be asked", async () => {
    const probe = createSlackWorkspaceProbe({
      listInstalledWorkspaces: async () => ["T1", "T2"],
      conversationStanding: async (
        _channel: string,
        teamId: string,
      ): Promise<SlackConversationStanding> => {
        if (teamId === "T2") throw new Error("missing_scope");
        return "unknown";
      },
    });

    expect(await probe("C1")).toEqual({ kind: "unknown" });
  });

  /**
   * TEST_SCENARIO: A bind while no replica holds the Slack connection, which is
   * what an api-server rollout leaves behind for a lease TTL. Every question
   * then runs to the bus timeout, so asking one workspace after another makes a
   * single bind wait out all of them in turn, and the ones asked last could be
   * answered by the new holder while the first ones had already given up —
   * a definite no from workspaces nobody heard from. Asking together is what
   * prevents that, so here no workspace answers until every one of them has
   * been asked: a probe that asks in turn never gets past the first.
   */
  it("asks every workspace at once", async () => {
    const candidateCount = 3;
    const waiting: Array<() => void> = [];

    const probe = createSlackWorkspaceProbe({
      listInstalledWorkspaces: async () => ["T1", "T2", "T3"],
      conversationStanding: (_channel: string, teamId: string) =>
        new Promise<SlackConversationStanding>((resolve) => {
          waiting.push(() => resolve(teamId === "T3" ? "member" : "unknown"));
          if (waiting.length === candidateCount)
            for (const answer of waiting) answer();
        }),
    });

    expect(await probe("C1")).toEqual({ kind: "resolved", teamId: "T3" });
  });
});
