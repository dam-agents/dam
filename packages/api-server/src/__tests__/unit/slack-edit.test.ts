/**
 * TEST_OVERVIEW: classifySlackEdit decides whether a changed Slack post is an
 * edit of its text, and who made it. Slack reports a change for link
 * previews, pins and deleted posts too, so only a post whose text now reads
 * differently counts. The writer is read by the rule a new post is read with.
 * The edit names the post by its own send time, not the time of the edit, and
 * says whether it is what first tagged the bot.
 */
import { describe, expect, it } from "vitest";
import { classifySlackEdit } from "../../modules/channels/infrastructure/slack-edit.js";

const self = { userId: "UBOT", botId: "BSELF" };

const footer = [
  {
    type: "context",
    elements: [{ type: "mrkdwn", text: "<http://ui/a/agent-abc123|Alpha>" }],
  },
];

describe("classifySlackEdit", () => {
  it("reads a person's edit", () => {
    expect(
      classifySlackEdit(
        {
          message: {
            user: "U1",
            ts: "100.000000",
            text: "invite Anna and Pavel",
          },
          previous_message: { text: "invite Anna and Petr" },
        },
        self,
      ),
    ).toEqual({
      sender: { kind: "person", user: "U1" },
      ts: "100.000000",
      text: "invite Anna and Pavel",
      mentionAdded: false,
    });
  });

  /** TEST_SCENARIO: Slack sends the same change event when a link preview
   *  arrives or a post is pinned. The text reads the same, so nothing was
   *  edited. */
  it("drops a change that leaves the text as it was", () => {
    expect(
      classifySlackEdit(
        {
          message: {
            user: "U1",
            ts: "100.000000",
            text: "see https://example.com",
            attachments: [{ title: "Example", text: "A preview" }],
          },
          previous_message: {
            text: "see https://example.com",
            attachments: [{ title: "Example", text: "A preview" }],
          },
        },
        self,
      ),
    ).toBeNull();
  });

  /** TEST_SCENARIO: A deleted post that had replies stays as a tombstone, and
   *  Slack reports that as a change. It is not an edit. */
  it("drops a post left as a tombstone", () => {
    expect(
      classifySlackEdit(
        {
          message: {
            user: "USLACKBOT",
            subtype: "tombstone",
            ts: "100.000000",
            text: "This message was deleted.",
          },
          previous_message: { text: "invite Anna and Petr" },
        },
        self,
      ),
    ).toBeNull();
  });

  it("reads an agent's edit of its own post from the footer", () => {
    expect(
      classifySlackEdit(
        {
          message: {
            user: "UBOT",
            bot_id: "BSELF",
            ts: "100.000000",
            text: "step 2 of 3",
            blocks: footer,
          },
          previous_message: { text: "step 1 of 3", blocks: footer },
        },
        self,
      )?.sender,
    ).toEqual({ kind: "agent", agentId: "agent-abc123", ambientRound: false });
  });

  it("drops an edit of this app's post that names no agent", () => {
    expect(
      classifySlackEdit(
        {
          message: {
            user: "UBOT",
            bot_id: "BSELF",
            ts: "100.000000",
            text: "still starting",
          },
          previous_message: { text: "waking" },
        },
        self,
      ),
    ).toBeNull();
  });

  it("keeps the thread of an edited reply", () => {
    expect(
      classifySlackEdit(
        {
          message: {
            user: "U1",
            ts: "110.000000",
            thread_ts: "100.000000",
            text: "new",
          },
          previous_message: { text: "old" },
        },
        self,
      )?.threadTs,
    ).toBe("100.000000");
  });

  /** TEST_SCENARIO: A post that opened a thread names itself as its thread.
   *  It is still a top-level post, so its edit names no thread. */
  it("reads the post that opened a thread as top-level", () => {
    const edit = classifySlackEdit(
      {
        message: {
          user: "U1",
          ts: "100.000000",
          thread_ts: "100.000000",
          text: "new",
        },
        previous_message: { text: "old" },
      },
      self,
    );
    expect(edit).not.toBeNull();
    expect(edit).not.toHaveProperty("threadTs");
  });

  it("says when the edit is what first tags the bot", () => {
    const tagged = (before: string, after: string) =>
      classifySlackEdit(
        {
          message: { user: "U1", ts: "100.000000", text: after },
          previous_message: { text: before },
        },
        self,
      )?.mentionAdded;

    expect(tagged("what is the plan", "<@UBOT> what is the plan")).toBe(true);
    expect(tagged("<@UBOT> what is the plan", "<@UBOT> what was it")).toBe(
      false,
    );
    expect(tagged("what is the plan", "what was the plan")).toBe(false);
  });
});
