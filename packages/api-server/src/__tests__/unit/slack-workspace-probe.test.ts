import { describe, it, expect } from "vitest";
import { createSlackWorkspaceProbe } from "../../modules/channels/services/slack-workspace-probe.js";

// TEST_OVERVIEW: Which Slack workspace a bare conversation id belongs to. A
// channel id is unique inside its workspace, not across them, so once a second
// workspace is installed the id a person types no longer says where it lives.
// The probe asks Slack rather than the person, and refuses rather than guesses:
// binding an Agent into the wrong workspace would lend it to strangers.

const NEVER_ASKED = async () => {
  throw new Error("Slack was asked about a conversation it need not be");
};

describe("slack workspace probe", () => {
  // TEST_SCENARIO: The install that predates multi-workspace support. Nothing
  // else is installed, so the answer is the original workspace and Slack is
  // never called — a single-workspace install must not pay for a feature it
  // does not use.
  it("answers for a lone install without asking Slack", async () => {
    const probe = createSlackWorkspaceProbe({
      listInstalledWorkspaces: async () => [],
      knowsConversation: NEVER_ASKED,
    });

    expect(await probe("C1")).toEqual({ kind: "resolved", teamId: "" });
  });

  // TEST_SCENARIO: A second workspace is installed and only it knows the
  // conversation. That is the whole point of the probe — the id resolves to the
  // workspace that recognises it, not to the operator's original one.
  it("resolves to the one installed workspace that knows the conversation", async () => {
    const probe = createSlackWorkspaceProbe({
      listInstalledWorkspaces: async () => ["T2"],
      knowsConversation: async (_channel, teamId) => teamId === "T2",
    });

    expect(await probe("C1")).toEqual({ kind: "resolved", teamId: "T2" });
  });

  // TEST_SCENARIO: The original workspace still wins when it is the one that
  // knows the conversation, and it is reported as the empty workspace rather
  // than a team id — old and new bindings then share one key, so the
  // uniqueness index keeps holding and nothing needs backfilling.
  it("reports the original workspace as the empty workspace", async () => {
    const probe = createSlackWorkspaceProbe({
      listInstalledWorkspaces: async () => ["T2"],
      knowsConversation: async (_channel, teamId) => teamId === "",
    });

    expect(await probe("C1")).toEqual({ kind: "resolved", teamId: "" });
  });

  // TEST_SCENARIO: Two workspaces both recognise the id. Picking one would bind
  // the Agent into a workspace the person did not mean, so the probe refuses
  // and names what it found.
  it("refuses when more than one workspace knows the conversation", async () => {
    const probe = createSlackWorkspaceProbe({
      listInstalledWorkspaces: async () => ["T2"],
      knowsConversation: async () => true,
    });

    expect(await probe("C1")).toEqual({
      kind: "ambiguous",
      teamIds: ["", "T2"],
    });
  });

  // TEST_SCENARIO: Nobody recognises the id — a typo, or a private channel the
  // bot was never invited to. Refused for the same reason, with nothing found.
  it("refuses when no workspace knows the conversation", async () => {
    const probe = createSlackWorkspaceProbe({
      listInstalledWorkspaces: async () => ["T2"],
      knowsConversation: async () => false,
    });

    expect(await probe("C1")).toEqual({ kind: "ambiguous", teamIds: [] });
  });

  // TEST_SCENARIO: One workspace's token is rejected or the call fails. A
  // workspace that cannot answer is not a workspace that said yes, so the
  // healthy one still resolves and a transient failure does not block a bind.
  it("treats a workspace that cannot answer as not knowing it", async () => {
    const probe = createSlackWorkspaceProbe({
      listInstalledWorkspaces: async () => ["T2"],
      knowsConversation: async (_channel, teamId) => {
        if (teamId === "") throw new Error("invalid_auth");
        return true;
      },
    });

    expect(await probe("C1")).toEqual({ kind: "resolved", teamId: "T2" });
  });
});
