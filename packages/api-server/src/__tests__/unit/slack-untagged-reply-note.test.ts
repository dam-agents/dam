import { describe, it, expect } from "vitest";
import { slackWorkerHarness } from "../helpers/slack-worker.js";
import { createMemorySlackUntaggedReplyNotes } from "../../modules/channels/infrastructure/slack-untagged-reply-notes-repository.js";
import type { UntaggedNoteLearner } from "../../modules/channels/domain/untagged-reply-note.js";
import type { SlackMessage } from "../../modules/channels/infrastructure/slack-gateway.js";

/**
 * TEST_OVERVIEW: In a mention-only channel, a person who replies in an
 * Agent's thread without tagging the bot is dropped, and the platform may tell
 * them, in a note only they see, how to reach the Agent. The note is a short
 * lesson for new users: it waits a quiet minute, goes only to a person who
 * first used the platform in Slack less than three weeks ago, at most once a
 * week across every channel, and never again once they tagged the bot after
 * a note. Agents never get it.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const ROOT = "100.000001";
const NEW_USER = "U-NEW";
const OLD_USER = "U-OLD";

function setup(
  opts: { learners?: Map<string, UntaggedNoteLearner>; start?: Date } = {},
) {
  const clock = { now: opts.start ?? new Date("2026-11-11T10:00:00Z") };
  const notes = createMemorySlackUntaggedReplyNotes({
    now: () => clock.now,
    ...(opts.learners ? { learners: opts.learners } : {}),
  });
  const h = slackWorkerHarness({
    untaggedReplyNotes: notes,
    untaggedNoteQuietMs: 0,
  });
  const advance = (ms: number) => {
    clock.now = new Date(clock.now.getTime() + ms);
  };
  const notesTo = (user: string) =>
    h.gw
      .readOutbound()
      .filter(
        (r) =>
          r.kind === "ephemeral" &&
          r.user === user &&
          r.text.includes("won't see this reply"),
      );
  async function agentAnswersIn(threadTs: string, asker = NEW_USER) {
    await h.worker.connect();
    const before = h.prompts.length;
    await h.gw.fireMention({
      user: asker,
      channel: "C1",
      ts: threadTs,
      text: "<@UBOT> hi",
    });
    await h.settled(() => h.prompts.length > before);
  }
  async function untaggedReply(
    user: string,
    ts: string,
    threadTs = ROOT,
    sender?: { kind: "agent"; agentId: string; ambientRound: false },
  ) {
    await h.gw.fireMessage({
      user,
      channel: "C1",
      ts,
      threadTs,
      text: "thanks, that helps",
      ...(sender ? { sender } : {}),
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return { h, notesTo, advance, agentAnswersIn, untaggedReply };
}

const longTimeUser = (): UntaggedNoteLearner => ({
  firstUsedAt: new Date("2026-09-01T10:00:00Z"),
  lastNotedAt: null,
  graduatedAt: null,
});

describe("the note about an untagged reply", () => {
  /** TEST_SCENARIO: AC-1. A person who used the platform in Slack more than
   *  three weeks ago knows how to tag the bot; a reply without the tag is to
   *  someone else, and a note would be noise. */
  it("never goes to a long-time user", async () => {
    const t = setup({ learners: new Map([[OLD_USER, longTimeUser()]]) });
    await t.agentAnswersIn(ROOT, OLD_USER);

    await t.untaggedReply(OLD_USER, "100.000002");

    expect(t.notesTo(OLD_USER)).toHaveLength(0);
  });

  /** TEST_SCENARIO: AC-2. A person new to the platform replies without a tag
   *  and nobody posts for a minute: they get the note, only they see it, in
   *  that thread. */
  it("goes to a new user after a quiet minute", async () => {
    const t = setup();
    await t.agentAnswersIn(ROOT);

    await t.untaggedReply(NEW_USER, "100.000002");

    expect(t.notesTo(NEW_USER)).toEqual([
      expect.objectContaining({
        kind: "ephemeral",
        channel: "C1",
        threadTs: ROOT,
        text: "Helper won't see this reply unless you tag <@U-BOT>. Only you can see this note.",
      }),
    ]);
  });

  /** TEST_SCENARIO: AC-3. Another person answering within the minute shows the
   *  reply was part of a conversation between people, so the note is held
   *  back. */
  it("is held back when someone else replies within the minute", async () => {
    const t = setup();
    await t.agentAnswersIn(ROOT);
    const thread = (ts: string, user: string): SlackMessage => ({
      ts,
      user,
      threadTs: ROOT,
      text: "…",
    });
    t.h.gw.setThreadedHistory([
      { ts: ROOT, user: NEW_USER, text: "<@UBOT> hi" },
      thread("100.000002", NEW_USER),
      thread("100.000003", "U-TEAMMATE"),
    ]);

    await t.untaggedReply(NEW_USER, "100.000002");

    expect(t.notesTo(NEW_USER)).toHaveLength(0);
  });

  /** TEST_SCENARIO: the writer's own follow-up in the minute is not a sign
   *  they were talking to someone else, so it does not hold the note back. */
  it("is not held back by the writer's own follow-up", async () => {
    const t = setup();
    await t.agentAnswersIn(ROOT);
    t.h.gw.setThreadedHistory([
      { ts: ROOT, user: NEW_USER, text: "<@UBOT> hi" },
      { ts: "100.000002", user: NEW_USER, threadTs: ROOT, text: "…" },
      { ts: "100.000003", user: NEW_USER, threadTs: ROOT, text: "anyone?" },
    ]);

    await t.untaggedReply(NEW_USER, "100.000002");

    expect(t.notesTo(NEW_USER)).toHaveLength(1);
  });

  /** TEST_SCENARIO: AC-4. The note shows at most once a week, in any channel
   *  and any thread, so a new user sees it at most three times in their first
   *  three weeks. */
  it("shows at most once a week, across threads", async () => {
    const t = setup();
    await t.agentAnswersIn(ROOT);
    await t.untaggedReply(NEW_USER, "100.000002");
    await t.agentAnswersIn("200.000001", "U-ASKER");

    await t.untaggedReply(NEW_USER, "200.000002", "200.000001");
    expect(t.notesTo(NEW_USER)).toHaveLength(1);

    t.advance(7 * DAY_MS + 1000);
    await t.untaggedReply(NEW_USER, "200.000003", "200.000001");
    t.advance(7 * DAY_MS + 1000);
    await t.untaggedReply(NEW_USER, "200.000004", "200.000001");
    t.advance(7 * DAY_MS + 1000);
    await t.untaggedReply(NEW_USER, "200.000005", "200.000001");

    expect(t.notesTo(NEW_USER)).toHaveLength(3);
  });

  /** TEST_SCENARIO: AC-5. A person who tagged the bot after a note has learned
   *  it, so the note never comes back, even after its weekly pause. */
  it("never comes back after a correct tag", async () => {
    const t = setup();
    await t.agentAnswersIn(ROOT);
    await t.untaggedReply(NEW_USER, "100.000002");
    expect(t.notesTo(NEW_USER)).toHaveLength(1);
    await t.agentAnswersIn("200.000001");

    t.advance(8 * DAY_MS);
    await t.untaggedReply(NEW_USER, "200.000002", "200.000001");

    expect(t.notesTo(NEW_USER)).toHaveLength(1);
  });

  /** TEST_SCENARIO: AC-6. An Agent's post without a tag is dropped like a
   *  person's, but an Agent is no learner, so no note is posted. */
  it("never goes to an agent", async () => {
    const t = setup();
    await t.agentAnswersIn(ROOT);
    const before = t.h.gw.readOutbound().length;

    await t.untaggedReply("UBOT", "100.000002", ROOT, {
      kind: "agent",
      agentId: "agent-2",
      ambientRound: false,
    });

    expect(
      t.h.gw
        .readOutbound()
        .slice(before)
        .filter((r) => r.kind === "ephemeral"),
    ).toHaveLength(0);
  });
});
