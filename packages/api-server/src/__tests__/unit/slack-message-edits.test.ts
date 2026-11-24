import { describe, it, expect } from "vitest";
import { configureLogger } from "../../core/logger.js";
import { slackWorkerHarness } from "../helpers/slack-worker.js";
import type { AcpClient, SteerOutcome } from "../../core/acp-client.js";
import { createMemorySlackOwnedThreads } from "../../modules/channels/infrastructure/slack-owned-threads-repository.js";
import type { SlackSender } from "../../modules/channels/infrastructure/slack-sender.js";

configureLogger({ level: "error", write: () => {} });

/**
 * TEST_OVERVIEW: What an edit to a Slack message does to the Agents in the
 * conversation. A person's edit to a message an Agent was sent follows that
 * message: it replaces the message while it still waits, joins the turn that
 * carries it, or starts a turn on the Session that answered it, marked as the
 * text that replaces the earlier one. An edit that first tags the bot is a
 * new mention. A person's edit to a message Agents read along starts an
 * ambient round, marked the same way. An edit by an Agent starts no turn; the
 * Agent's next turn lists the message as it reads now, once. A conversation
 * disconnected since the message was sent gets nothing.
 */

const BOUND = "C1";
const USER = "U1";
const BLUE = "reply with the word blue";
const GREEN = "reply with the word green";
const EDITED = "[edited:";
const CHANGED = "<changed-messages>";

const T1 = "100.000000";
const T2 = "200.000000";
const T3 = "300.000000";

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

const NOTES_URL = "https://files.slack.com/files-pri/T1-F1/notes.txt";
const NOTES = {
  id: "F1",
  name: "notes.txt",
  mimetype: "text/plain",
  url_private: NOTES_URL,
  size: 5,
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: holds the download of a message's file until the
 * spec lets it go, so a spec can send an edit while the message has arrived
 * but is not queued yet.
 */
function heldDownload(gw: ReturnType<typeof slackWorkerHarness>["gw"]) {
  let release!: () => void;
  let begin!: () => void;
  const started = new Promise<void>((resolve) => (begin = resolve));
  const gate = new Promise<void>((resolve) => (release = resolve));
  const download = gw.downloadFile.bind(gw);
  gw.setFileBytes(NOTES_URL, Buffer.from("notes"));
  gw.downloadFile = async (...args) => {
    begin();
    await gate;
    return download(...args);
  };
  return { started, release: () => release() };
}

function harness(opts: Parameters<typeof slackWorkerHarness>[0] = {}) {
  const h = slackWorkerHarness({
    boundChannelId: BOUND,
    channels: [{ id: BOUND, name: "general", botIsMember: true }],
    ...opts,
  });
  const turns = () =>
    h.prompts
      .map((p) => (typeof p === "string" ? p : JSON.stringify(p)))
      .filter((p) => !p.includes("<turn-undelivered>"));
  return { ...h, turns };
}

function gatedAcp(steerOutcome: SteerOutcome, blockCall = 1) {
  let release!: () => void;
  let started!: () => void;
  let call = 0;
  const startedAt = new Promise<void>((resolve) => (started = resolve));
  const gate = new Promise<void>((resolve) => (release = resolve));
  const steers: string[] = [];
  const makeAcp = (base: AcpClient): AcpClient => ({
    ...base,
    steer: async (_sessionId, frame) => {
      steers.push(String(frame));
      return steerOutcome;
    },
    sendPrompt: async (prompt, sendOpts) => {
      const nudge = String(prompt).includes("<turn-undelivered>");
      if (!nudge) call += 1;
      sendOpts.onSession?.(
        "resumeSessionId" in sendOpts &&
          typeof sendOpts.resumeSessionId === "string"
          ? sendOpts.resumeSessionId
          : "s-live",
        `prompt-${call}`,
      );
      const answer = await base.sendPrompt(prompt, sendOpts);
      if (!nudge && call === blockCall) {
        started();
        await gate;
      }
      return answer;
    },
  });
  return { makeAcp, steers, startedAt, release: () => release() };
}

describe("a person's edit to a message an agent was sent", () => {
  /**
   * TEST_SCENARIO: The person fixes the message before the agent starts on
   * it. The agent must work from the fixed text and never see the first one,
   * so the turn carries the message once, with no edit mark.
   */
  it("replaces a message that still waits for its turn", async () => {
    const h = harness({ settleMs: 200 });
    await h.worker.connect();

    const sent = h.gw.fireMention({
      user: USER,
      channel: BOUND,
      ts: T1,
      text: BLUE,
    });
    await pause(20);
    await h.gw.fireMessageEdited({
      user: USER,
      channel: BOUND,
      ts: T1,
      text: GREEN,
    });
    await sent;

    expect(h.turns()).toHaveLength(1);
    expect(h.turns()[0]).toContain(GREEN);
    expect(h.turns()[0]).not.toContain(BLUE);
    expect(h.turns()[0]).not.toContain(EDITED);
  });

  /**
   * TEST_SCENARIO: A message with a file is not queued until the file is
   * fetched. An edit in that time finds the message in no queue, and must
   * still reach the turn: the agent reads the message once, as edited.
   */
  it("replaces a message whose file is still being fetched", async () => {
    const h = harness();
    const download = heldDownload(h.gw);
    await h.worker.connect();

    const sent = h.gw.fireMention({
      user: USER,
      channel: BOUND,
      ts: T1,
      text: BLUE,
      files: [NOTES],
    });
    await download.started;
    await h.gw.fireMessageEdited({
      user: USER,
      channel: BOUND,
      ts: T1,
      text: GREEN,
    });
    download.release();
    await sent;

    expect(h.turns()).toHaveLength(1);
    expect(h.turns()[0]).toContain(GREEN);
    expect(h.turns()[0]).not.toContain(BLUE);
    expect(h.turns()[0]).not.toContain(EDITED);
  });

  /**
   * TEST_SCENARIO: The agent is working on the message when the person edits
   * it. The edit is steered into that turn, marked as the text that replaces
   * the message, so the agent's one answer can already follow it.
   */
  it("joins the turn that carries the message", async () => {
    const gate = gatedAcp("injected");
    const h = harness({ makeAcp: gate.makeAcp });
    await h.worker.connect();

    const sent = h.gw.fireMention({
      user: USER,
      channel: BOUND,
      ts: T1,
      text: BLUE,
    });
    await gate.startedAt;
    void h.gw.fireMessageEdited({
      user: USER,
      channel: BOUND,
      ts: T1,
      text: GREEN,
    });
    expect(await h.settled(() => gate.steers.length === 1)).toBe(true);
    gate.release();
    await sent;

    expect(gate.steers[0]).toContain(EDITED);
    expect(gate.steers[0]).toContain(`ts ${T1}`);
    expect(gate.steers[0]).toContain(GREEN);
    expect(h.turns()).toHaveLength(1);
  });

  /**
   * TEST_SCENARIO: A harness that cannot be steered still gets the edit: it
   * waits for the running turn and becomes the next one, on the same Session.
   */
  it("becomes the next turn where the harness takes no steer", async () => {
    const gate = gatedAcp("unsupported");
    const h = harness({ makeAcp: gate.makeAcp });
    await h.worker.connect();

    const sent = h.gw.fireMention({
      user: USER,
      channel: BOUND,
      ts: T1,
      text: BLUE,
    });
    await gate.startedAt;
    const edited = h.gw.fireMessageEdited({
      user: USER,
      channel: BOUND,
      ts: T1,
      text: GREEN,
    });
    await pause(5);
    gate.release();
    await Promise.all([sent, edited]);

    expect(await h.settled(() => h.turns().length === 2)).toBe(true);
    expect(h.turns()[1]).toContain(EDITED);
    expect(h.turns()[1]).toContain(GREEN);
    expect(h.created).toHaveLength(1);
  });

  /**
   * TEST_SCENARIO: The reported case. The agent already answered, then the
   * person corrects the message. The edit starts a turn of its own on the
   * Session that answered, carrying only the new text and naming the message
   * it replaces; the earlier text is in that Session already.
   */
  it("starts a turn on the session that answered", async () => {
    const h = harness();
    await h.worker.connect();

    await h.gw.fireMention({ user: USER, channel: BOUND, ts: T1, text: BLUE });
    await h.gw.fireMessageEdited({
      user: USER,
      channel: BOUND,
      ts: T1,
      text: GREEN,
    });

    expect(h.turns()).toHaveLength(2);
    expect(h.turns()[1]).toContain(EDITED);
    expect(h.turns()[1]).toContain(`ts ${T1}`);
    expect(h.turns()[1]).toContain(GREEN);
    expect(h.turns()[1]).not.toContain(BLUE);
    expect(h.created).toHaveLength(1);
  });

  /**
   * TEST_SCENARIO: Slack can report the same edit twice. A second report
   * with the text the agent already has must not cost another turn.
   */
  it("starts nothing for an edit the agent already has", async () => {
    const h = harness();
    await h.worker.connect();

    await h.gw.fireMention({ user: USER, channel: BOUND, ts: T1, text: BLUE });
    const edit = { user: USER, channel: BOUND, ts: T1, text: GREEN };
    await h.gw.fireMessageEdited(edit);
    await h.gw.fireMessageEdited(edit);

    expect(h.turns()).toHaveLength(2);
  });

  /**
   * TEST_SCENARIO: A direct message needs no tag, and each one is answered on
   * a Session of its own. An edit after the answer goes to that Session.
   */
  it("follows a direct message to the session that answered it", async () => {
    const h = harness({ boundChannelId: "D1", channels: [] });
    await h.worker.connect();

    await h.gw.fireDirectMessage({
      user: USER,
      channel: "D1",
      ts: T1,
      text: BLUE,
    });
    await h.gw.fireMessageEdited({
      user: USER,
      channel: "D1",
      channelType: "im",
      ts: T1,
      text: GREEN,
    });

    expect(h.turns()).toHaveLength(2);
    expect(h.turns()[1]).toContain(EDITED);
    expect(h.turns()[1]).toContain(GREEN);
    expect(h.created).toHaveLength(1);
  });

  /**
   * TEST_SCENARIO: Direct messages sent in a burst run as one turn, on the
   * Session the first of them opened. An edit to a later one of the burst
   * must go to that Session, not open a new one that never saw the message.
   */
  it("follows a later message of a burst to the burst's session", async () => {
    const h = harness({ boundChannelId: "D1", channels: [], settleMs: 50 });
    await h.worker.connect();

    await Promise.all([
      h.gw.fireDirectMessage({
        user: USER,
        channel: "D1",
        ts: T1,
        text: "first part",
      }),
      h.gw.fireDirectMessage({ user: USER, channel: "D1", ts: T2, text: BLUE }),
    ]);
    expect(h.turns()).toHaveLength(1);
    await h.gw.fireMessageEdited({
      user: USER,
      channel: "D1",
      channelType: "im",
      ts: T2,
      text: GREEN,
    });

    expect(h.turns()).toHaveLength(2);
    expect(h.turns()[1]).toContain(EDITED);
    expect(h.created).toHaveLength(1);
  });

  /**
   * TEST_SCENARIO: A person edits an answered direct message while the agent
   * works on a newer one. The newer message runs on another Session, which
   * never did the work the edit asks to correct, so the edit must not be
   * steered into it; it goes to the Session that answered the edited message.
   */
  it("keeps an edit out of a newer direct message's turn", async () => {
    const gate = gatedAcp("injected", 2);
    const h = harness({
      boundChannelId: "D1",
      channels: [],
      makeAcp: gate.makeAcp,
    });
    await h.worker.connect();

    await h.gw.fireDirectMessage({
      user: USER,
      channel: "D1",
      ts: T1,
      text: BLUE,
    });
    const newer = h.gw.fireDirectMessage({
      user: USER,
      channel: "D1",
      ts: T2,
      text: "something else",
    });
    await gate.startedAt;
    await h.gw.fireMessageEdited({
      user: USER,
      channel: "D1",
      channelType: "im",
      ts: T1,
      text: GREEN,
    });
    gate.release();
    await newer;

    expect(gate.steers).toHaveLength(0);
    expect(h.turns()).toHaveLength(3);
    expect(h.turns()[2]).toContain(EDITED);
    expect(h.created).toHaveLength(2);
  });

  /**
   * TEST_SCENARIO: The binding is the authorization, and an edit can come
   * long after its message. A conversation disconnected in between must not
   * start a turn from the edit.
   */
  it("starts nothing once the conversation is disconnected", async () => {
    let connected = true;
    const h = harness({ connected: () => connected });
    await h.worker.connect();

    await h.gw.fireMention({ user: USER, channel: BOUND, ts: T1, text: BLUE });
    connected = false;
    await h.gw.fireMessageEdited({
      user: USER,
      channel: BOUND,
      ts: T1,
      text: GREEN,
    });

    expect(h.turns()).toHaveLength(1);
  });

  /**
   * TEST_SCENARIO: A thread a Session started brings every message in it back
   * to that Session, so an edit there goes back to it too, with the silence a
   * Session outside a channel turn has: it simply does not answer.
   */
  it("goes to the session that owns the thread", async () => {
    const ownedThreads = createMemorySlackOwnedThreads();
    await ownedThreads.own({
      channelId: BOUND,
      threadTs: T1,
      teamId: "",
      agentId: "agent-1",
      sessionId: "web-1",
      firstLine: "status of the release",
    });
    const h = harness({
      ownedThreads,
      sessions: [{ sessionId: "web-1" }] as never,
    });
    await h.worker.connect();

    await h.gw.fireMessage({
      user: USER,
      channel: BOUND,
      ts: T2,
      threadTs: T1,
      text: BLUE,
    });
    expect(await h.settled(() => h.turns().length === 1)).toBe(true);
    await h.gw.fireMessageEdited({
      user: USER,
      channel: BOUND,
      ts: T2,
      threadTs: T1,
      text: GREEN,
    });

    expect(await h.settled(() => h.turns().length === 2)).toBe(true);
    expect(h.turns()[1]).toContain(EDITED);
    expect(h.turns()[1]).toContain(GREEN);
    expect(h.turns()[1]).toContain("do not answer it");
  });
});

describe("an edit in a thread a session owns", () => {
  /**
   * TEST_SCENARIO: The Session already holds a message of its thread when an
   * edit adds the bot's tag to it. Slack reports that as an edit and as a
   * mention. Neither may hand the Session the message again as a new one: it
   * gets the edit once, marked as replacing what it holds.
   */
  it("gets an edit that adds the tag once, as an edit", async () => {
    const ownedThreads = createMemorySlackOwnedThreads();
    await ownedThreads.own({
      channelId: BOUND,
      threadTs: T1,
      teamId: "",
      agentId: "agent-1",
      sessionId: "web-1",
      firstLine: "status of the release",
    });
    const h = harness({
      ownedThreads,
      sessions: [{ sessionId: "web-1" }] as never,
    });
    await h.worker.connect();
    const tagged = `<@UBOT> ${GREEN}`;

    await h.gw.fireMessage({
      user: USER,
      channel: BOUND,
      ts: T2,
      threadTs: T1,
      text: BLUE,
    });
    expect(await h.settled(() => h.turns().length === 1)).toBe(true);
    await h.gw.fireMessageEdited({
      user: USER,
      channel: BOUND,
      ts: T2,
      threadTs: T1,
      text: tagged,
      mentionAdded: true,
    });
    await h.gw.fireMention({
      user: USER,
      channel: BOUND,
      ts: T2,
      threadTs: T1,
      text: tagged,
    });

    expect(await h.settled(() => h.turns().length === 2)).toBe(true);
    await pause(5);
    expect(h.turns()).toHaveLength(2);
    expect(h.turns()[1]).toContain(EDITED);
  });
});

describe("an edit that first tags the bot", () => {
  /**
   * TEST_SCENARIO: A person forgets the tag and adds it with an edit. The
   * message was never sent to an agent, so the edit is the mention: a turn
   * starts from the message as it reads now, with no edit mark.
   */
  it("is a mention sent at that moment", async () => {
    const h = harness();
    await h.worker.connect();

    await h.gw.fireMessage({ user: USER, channel: BOUND, ts: T1, text: BLUE });
    expect(h.turns()).toHaveLength(0);
    await h.gw.fireMessageEdited({
      user: USER,
      channel: BOUND,
      ts: T1,
      text: `<@UBOT> ${BLUE}`,
      mentionAdded: true,
    });

    expect(h.turns()).toHaveLength(1);
    expect(h.turns()[0]).toContain(BLUE);
    expect(h.turns()[0]).not.toContain(EDITED);
  });

  /**
   * TEST_SCENARIO: Slack can also report such an edit as a mention of its
   * own, before or after it reports the edit. Whichever arrives first starts
   * the turn, and the other one must not start a second.
   */
  it("starts one turn when Slack reports the mention too", async () => {
    const tagged = `<@UBOT> ${BLUE}`;
    const edit = {
      user: USER,
      channel: BOUND,
      ts: T1,
      text: tagged,
      mentionAdded: true,
    };
    const mention = { user: USER, channel: BOUND, ts: T1, text: tagged };

    const editFirst = harness();
    await editFirst.worker.connect();
    await editFirst.gw.fireMessageEdited(edit);
    await editFirst.gw.fireMention(mention);
    expect(editFirst.turns()).toHaveLength(1);

    const mentionFirst = harness();
    await mentionFirst.worker.connect();
    await mentionFirst.gw.fireMention(mention);
    await mentionFirst.gw.fireMessageEdited(edit);
    expect(mentionFirst.turns()).toHaveLength(1);
  });

  /**
   * TEST_SCENARIO: Slack can report a mention again when its message is
   * edited. The edit already follows the message on its own road, so the
   * repeated mention must not start a turn that carries the new text as if it
   * were a new message.
   */
  it("starts no second turn when Slack repeats an edited mention", async () => {
    const h = harness();
    await h.worker.connect();

    await h.gw.fireMention({ user: USER, channel: BOUND, ts: T1, text: BLUE });
    await h.gw.fireMention({ user: USER, channel: BOUND, ts: T1, text: GREEN });
    await h.gw.fireMessageEdited({
      user: USER,
      channel: BOUND,
      ts: T1,
      text: GREEN,
    });

    expect(h.turns()).toHaveLength(2);
    expect(h.turns()[1]).toContain(EDITED);
  });
});

describe("a person's edit to a message agents read along", () => {
  /**
   * TEST_SCENARIO: An agent that reads along answered nothing to a person's
   * message, and the person edits it to add a question. The agent would
   * otherwise see the question only when someone posts again, so the edit
   * starts a round of its own, as a new message would: the new text with the
   * edit mark, so the agent knows it replaces the message and may stay
   * silent.
   */
  it("starts a round with the new text, marked as an edit", async () => {
    const h = harness({ ambient: true });
    h.gw.setHistory([{ ts: T1, user: USER, text: BLUE }]);
    await h.worker.connect();

    await h.gw.fireMessage({ user: USER, channel: BOUND, ts: T1, text: BLUE });
    expect(await h.settled(() => h.turns().length === 1)).toBe(true);

    h.gw.setHistory([{ ts: T1, user: USER, text: GREEN, edited: true }]);
    await h.gw.fireMessageEdited({
      user: USER,
      channel: BOUND,
      ts: T1,
      text: GREEN,
    });
    expect(await h.settled(() => h.turns().length === 2)).toBe(true);
    expect(h.turns()[1]).toContain(`${EDITED} the sender changed`);
    expect(h.turns()[1]).toContain(`ts ${T1}`);
    expect(h.turns()[1]).toContain(GREEN);
    expect(h.turns()[1]).toContain("<reading-along>");
    expect(h.turns()[1]).toContain("no_reply_needed");
    expect(h.turns()[1]).not.toContain(CHANGED);
  });

  /**
   * TEST_SCENARIO: Slack can report one edit twice, or report a change that
   * leaves the text as it was. The agent already has that text, so the
   * second report starts no round.
   */
  it("starts no second round when Slack reports the edit twice", async () => {
    const h = harness({ ambient: true });
    await h.worker.connect();
    const edit = { user: USER, channel: BOUND, ts: T1, text: GREEN };

    await h.gw.fireMessage({ user: USER, channel: BOUND, ts: T1, text: BLUE });
    expect(await h.settled(() => h.turns().length === 1)).toBe(true);
    await h.gw.fireMessageEdited(edit);
    expect(await h.settled(() => h.turns().length === 2)).toBe(true);

    await h.gw.fireMessageEdited(edit);
    await pause(20);
    expect(h.turns()).toHaveLength(2);
  });

  /**
   * TEST_SCENARIO: The edit's round carries the message the turn asks about,
   * so the next turn does not list that edit again as a changed message.
   */
  it("is not listed again in the next turn", async () => {
    const h = harness({ ambient: true });
    h.gw.setHistory([{ ts: T1, user: USER, text: BLUE }]);
    await h.worker.connect();

    await h.gw.fireMessage({ user: USER, channel: BOUND, ts: T1, text: BLUE });
    expect(await h.settled(() => h.turns().length === 1)).toBe(true);
    await h.gw.fireMessageEdited({
      user: USER,
      channel: BOUND,
      ts: T1,
      text: GREEN,
    });
    expect(await h.settled(() => h.turns().length === 2)).toBe(true);

    h.gw.setHistory([
      { ts: T1, user: USER, text: GREEN, edited: true },
      { ts: T2, user: USER, text: "anything new?" },
    ]);
    await h.gw.fireMessage({
      user: USER,
      channel: BOUND,
      ts: T2,
      text: "anything new?",
    });
    expect(await h.settled(() => h.turns().length === 3)).toBe(true);
    expect(h.turns()[2]).not.toContain(CHANGED);
  });

  /**
   * TEST_SCENARIO: A message a read-along agent has not started on yet is
   * edited. The agent reads it once, as it reads now, and is told of no
   * change: it never saw the earlier text.
   */
  it("replaces a message a read-along agent has not read yet", async () => {
    const h = harness({ ambient: true, settleMs: 200 });
    await h.worker.connect();

    await h.gw.fireMessage({ user: USER, channel: BOUND, ts: T1, text: BLUE });
    await pause(20);
    await h.gw.fireMessageEdited({
      user: USER,
      channel: BOUND,
      ts: T1,
      text: GREEN,
    });
    await pause(250);

    expect(await h.settled(() => h.turns().length === 1)).toBe(true);
    expect(h.turns()[0]).toContain(GREEN);
    expect(h.turns()[0]).not.toContain(BLUE);
    expect(h.turns()[0]).not.toContain(CHANGED);
  });

  /**
   * TEST_SCENARIO: A read-along message with a file is not queued until the
   * file is fetched. An edit in that time must replace its text all the same,
   * or the agent would read the first text and never be shown the edit.
   */
  it("replaces a read-along message whose file is still being fetched", async () => {
    const h = harness({ ambient: true });
    const download = heldDownload(h.gw);
    await h.worker.connect();

    const sent = h.gw.fireMessage({
      user: USER,
      channel: BOUND,
      ts: T1,
      text: BLUE,
      files: [NOTES],
    });
    await download.started;
    await h.gw.fireMessageEdited({
      user: USER,
      channel: BOUND,
      ts: T1,
      text: GREEN,
    });
    download.release();
    await sent;

    expect(await h.settled(() => h.turns().length === 1)).toBe(true);
    expect(h.turns()[0]).toContain(GREEN);
    expect(h.turns()[0]).not.toContain(BLUE);
    expect(h.turns()[0]).not.toContain(CHANGED);
  });
});

describe("an edit that starts no turn", () => {
  /**
   * TEST_SCENARIO: Another agent edits its post, and Slack reports the edit
   * twice. The reading agent is listed the edit once, in its next turn, and
   * the second report must not list it again.
   */
  it("lists an agent's edit once when Slack reports it twice", async () => {
    const peer: SlackSender = {
      kind: "agent",
      agentId: "agent-2",
      ambientRound: false,
    };
    const h = harness({ ambient: true });
    h.gw.setHistory([{ ts: T1, user: "UBOT", text: BLUE }]);
    await h.worker.connect();
    const edit = { sender: peer, channel: BOUND, ts: T1, text: GREEN };
    const edited = { ts: T1, user: "UBOT", text: GREEN, edited: true };

    await h.gw.fireMessage({
      sender: peer,
      channel: BOUND,
      ts: T1,
      text: BLUE,
    });
    expect(await h.settled(() => h.turns().length === 1)).toBe(true);
    await h.gw.fireMessageEdited(edit);

    h.gw.setHistory([edited, { ts: T2, user: USER, text: "anything new?" }]);
    await h.gw.fireMessage({
      user: USER,
      channel: BOUND,
      ts: T2,
      text: "anything new?",
    });
    expect(await h.settled(() => h.turns().length === 2)).toBe(true);
    expect(h.turns()[1]).toContain(CHANGED);

    await h.gw.fireMessageEdited(edit);
    h.gw.setHistory([
      edited,
      { ts: T2, user: USER, text: "anything new?" },
      { ts: T3, user: USER, text: "and now?" },
    ]);
    await h.gw.fireMessage({
      user: USER,
      channel: BOUND,
      ts: T3,
      text: "and now?",
    });
    expect(await h.settled(() => h.turns().length === 3)).toBe(true);
    expect(h.turns()[2]).not.toContain(CHANGED);
  });

  /**
   * TEST_SCENARIO: An agent asks a peer by tagging the bot, then corrects its
   * post while the peer has not started on it. An agent's edit starts no
   * turn, but the waiting post must still take the new text, or the peer
   * would act on the first one.
   */
  it("replaces an agent's tagged post that still waits for its turn", async () => {
    const peer: SlackSender = {
      kind: "agent",
      agentId: "agent-2",
      ambientRound: false,
    };
    const h = harness({ settleMs: 200 });
    await h.worker.connect();

    const sent = h.gw.fireMention({
      sender: peer,
      channel: BOUND,
      ts: T1,
      text: "<@UBOT> count the open issues",
    });
    await pause(20);
    await h.gw.fireMessageEdited({
      sender: peer,
      channel: BOUND,
      ts: T1,
      text: "<@UBOT> count the closed issues",
    });
    await sent;

    expect(h.turns()).toHaveLength(1);
    expect(h.turns()[0]).toContain("count the closed issues");
    expect(h.turns()[0]).not.toContain("count the open issues");
    expect(h.turns()[0]).not.toContain(EDITED);
  });

  /**
   * TEST_SCENARIO: Another agent keeps one post current by editing it. Each
   * edit starting a turn would multiply cost and let agents answer each other
   * in a loop, so the reading agent gets no turn and sees the post as it
   * reads now in its next one.
   */
  it("never starts a turn for another agent's edit", async () => {
    const peer: SlackSender = {
      kind: "agent",
      agentId: "agent-2",
      ambientRound: false,
    };
    const h = harness({ ambient: true });
    h.gw.setHistory([{ ts: T1, user: "UBOT", text: "step 1 of 3" }]);
    await h.worker.connect();

    await h.gw.fireMessage({
      sender: peer,
      channel: BOUND,
      ts: T1,
      text: "step 1 of 3",
    });
    expect(await h.settled(() => h.turns().length === 1)).toBe(true);

    await h.gw.fireMessageEdited({
      sender: peer,
      channel: BOUND,
      ts: T1,
      text: "step 2 of 3",
    });
    await pause(5);
    expect(h.turns()).toHaveLength(1);

    h.gw.setHistory([
      { ts: T1, user: "UBOT", text: "step 2 of 3", edited: true },
      { ts: T2, user: USER, text: "how far is it?" },
    ]);
    await h.gw.fireMessage({
      user: USER,
      channel: BOUND,
      ts: T2,
      text: "how far is it?",
    });
    expect(await h.settled(() => h.turns().length === 2)).toBe(true);
    expect(h.turns()[1]).toContain(CHANGED);
    expect(h.turns()[1]).toContain("step 2 of 3");
  });

  /**
   * TEST_SCENARIO: An Agent of another install corrects its post, which the
   * reading agent already took. The edit is listed in the next turn under the
   * name the post had, as an agent from another install, although the record
   * of an edit keeps none of the post's blocks.
   */
  it("lists a companion's edit as an agent's from another install", async () => {
    const rex: SlackSender = {
      kind: "companion",
      botId: "B-STAGING",
      name: "Rex",
    };
    const h = harness({ ambient: true });
    await h.worker.connect();

    await h.gw.fireMessage({ sender: rex, channel: BOUND, ts: T1, text: BLUE });
    expect(await h.settled(() => h.turns().length === 1)).toBe(true);

    await h.gw.fireMessageEdited({
      sender: rex,
      channel: BOUND,
      ts: T1,
      text: GREEN,
      message: {
        ts: T1,
        botId: "B-STAGING",
        botName: "Rex",
        origin: "companion",
        text: GREEN,
        edited: true,
      },
    });
    await pause(5);

    h.gw.setHistory([{ ts: T2, user: USER, text: "anything new?" }]);
    await h.gw.fireMessage({
      user: USER,
      channel: BOUND,
      ts: T2,
      text: "anything new?",
    });
    expect(
      await h.settled(() => h.turns().some((turn) => turn.includes(CHANGED))),
    ).toBe(true);
    const listed = h.turns().find((turn) => turn.includes(CHANGED))!;
    expect(listed).toContain("Rex (an agent from another install) [");
    expect(listed).toContain(GREEN);
  });
});
