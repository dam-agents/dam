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
   * TEST_SCENARIO: The install that predates multi-workspace support. Nothing
   * else is installed, so the answer is the original workspace and Slack is
   * never called — a single-workspace install must not pay for a feature it
   * does not use.
   */
  it("answers for a lone install without asking Slack", async () => {
    const probe = createSlackWorkspaceProbe({
      listInstalledWorkspaces: async () => [],
      standingIn: NEVER_ASKED,
    });

    expect(await probe("C1")).toEqual({ kind: "resolved", teamId: "" });
  });

  /**
   * TEST_SCENARIO: A second workspace is installed and only it can see the
   * conversation. That is the whole point of the probe — the id resolves to the
   * workspace that has it, not to the operator's original one.
   */
  it("resolves to the installed workspace that has the conversation", async () => {
    const probe = createSlackWorkspaceProbe({
      listInstalledWorkspaces: async () => ["T2"],
      standingIn: async (_channel: string, teamId: string) =>
        teamId === "T2" ? "member" : "unknown",
    });

    expect(await probe("C1")).toEqual({ kind: "resolved", teamId: "T2" });
  });

  /**
   * TEST_SCENARIO: The original workspace is reported as the empty workspace
   * rather than a team id, so bindings made before multi-workspace support and
   * after it share one key — the uniqueness index keeps holding and nothing
   * needs backfilling.
   */
  it("reports the original workspace as the empty workspace", async () => {
    const probe = createSlackWorkspaceProbe({
      listInstalledWorkspaces: async () => ["T2"],
      standingIn: async (_channel: string, teamId: string) =>
        teamId === "" ? "member" : "unknown",
    });

    expect(await probe("C1")).toEqual({ kind: "resolved", teamId: "" });
  });

  /**
   * TEST_SCENARIO: An organization shares one channel into several of its
   * workspaces, so more than one answers yes. They are looking at the same
   * conversation and either token posts to the same place, so this is settled
   * rather than refused — on the original workspace, so repeated binds of the
   * same conversation always land on the same answer.
   */
  it("settles a conversation shared into several workspaces", async () => {
    const probe = createSlackWorkspaceProbe({
      listInstalledWorkspaces: async () => ["T2", "T3"],
      standingIn: async () => "member" as const,
    });

    expect(await probe("C1")).toEqual({ kind: "resolved", teamId: "" });
  });

  /**
   * TEST_SCENARIO: A workspace that can only see the channel cannot post into
   * it, so it loses to one the bot was actually invited to — even though the
   * seer is the original workspace and would otherwise win.
   */
  it("prefers a workspace the bot belongs to over one that only sees it", async () => {
    const probe = createSlackWorkspaceProbe({
      listInstalledWorkspaces: async () => ["T2"],
      standingIn: async (_channel: string, teamId: string) =>
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
      listInstalledWorkspaces: async () => ["T2"],
      standingIn: async () => "unknown" as const,
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
      listInstalledWorkspaces: async () => ["T2"],
      standingIn: async (
        _channel: string,
        teamId: string,
      ): Promise<SlackConversationStanding> => {
        if (teamId === "") throw new Error("invalid_auth");
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
      listInstalledWorkspaces: async () => ["T2"],
      standingIn: async () => {
        throw new Error("missing_scope");
      },
    });

    expect(await probe("C1")).toEqual({ kind: "unreachable" });
  });
});
