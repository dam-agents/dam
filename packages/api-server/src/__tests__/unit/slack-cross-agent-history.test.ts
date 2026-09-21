import { describe, it, expect } from "vitest";
import {
  agentContextBlock,
  formatSlackTs,
} from "../../modules/channels/infrastructure/agent-footer.js";
import { configureLogger } from "../../core/logger.js";
import { slackWorkerHarness } from "../helpers/slack-worker.js";
import type { StoredChannelConfig } from "../../modules/channels/stored-channel.js";

configureLogger({ level: "error", write: () => {} });

const FOOTER_LABEL = "Powered by DAM";

const harness = (boundChannelId = "C1") =>
  slackWorkerHarness({
    boundChannelId,
    agentNames: { "agent-1": "Helper", "agent-99": "Ops" },
  });

describe("slack cross-agent history attribution", () => {
  it("labels self, other agents, and humans in injected history", async () => {
    const h = harness();
    h.gw.setHistory([
      {
        ts: "0.1",
        user: "U-BOT",
        text: "already looking into it",
        blocks: [
          agentContextBlock({
            uiBaseUrl: "http://ui",
            agentId: "agent-1",
            label: FOOTER_LABEL,
          }),
        ],
      },
      {
        ts: "0.2",
        user: "U-BOT",
        text: "I ran the deploy",
        blocks: [
          agentContextBlock({
            uiBaseUrl: "http://ui",
            agentId: "agent-99",
            label: FOOTER_LABEL,
          }),
        ],
      },
      { ts: "0.3", user: "U999", text: "thanks all" },
    ]);

    await h.worker.connect();
    await h.gw.fireMention({
      user: "U999",
      channel: "C1",
      ts: "1.1",
      text: "hey agent",
    });

    expect(h.prompts).toHaveLength(1);
    const prompt = String(h.prompts[0]);
    expect(prompt).toContain(
      `you (this agent) [${formatSlackTs("0.1")}]: already looking into it`,
    );
    expect(prompt).toContain(
      `Ops (another agent) [${formatSlackTs("0.2")}]: I ran the deploy`,
    );
    expect(prompt).toContain(`U999 [${formatSlackTs("0.3")}]: thanks all`);
    expect(prompt).toContain("you (this agent)");
    expect(prompt).toContain("another agent");
    expect(prompt).not.toContain("agent-1");
    expect(prompt).not.toContain("agent-99");
  });

  /**
   * TEST_SCENARIO: Every post made before the footer moved to /a/ still sits in
   * channel history, carrying a /chat/ or /sandboxes/ URL. Attribution reaches
   * back through all of it, and a legacy footer that stops parsing fails
   * silently — the line just reattributes to the bare bot id. So each retired
   * form has to attribute by name from injected history, not only from a parse.
   */
  it.each([
    ["chat", "http://ui/chat/agent-99"],
    ["chat with a session path", "http://ui/chat/agent-99/sess-42"],
    ["sandboxes", "http://ui/sandboxes/agent-99"],
  ])("names an agent behind a legacy %s footer", async (_form, url) => {
    const h = harness();
    h.gw.setHistory([
      {
        ts: "0.1",
        user: "U-BOT",
        text: "I ran the deploy",
        blocks: [
          {
            type: "context",
            elements: [{ type: "mrkdwn", text: `<${url}|Ops>` }],
          },
        ],
      },
    ]);

    await h.worker.start("agent-1", {} as StoredChannelConfig);
    await h.gw.fireMention({
      user: "U999",
      channel: "C1",
      ts: "1.1",
      text: "hey agent",
    });

    const prompt = String(h.prompts[0]);
    expect(prompt).toContain(
      `Ops (another agent) [${formatSlackTs("0.1")}]: I ran the deploy`,
    );
    expect(prompt).not.toContain("U-BOT [");
  });

  /**
   * TEST_SCENARIO: Platform notices (wake failures, the still-starting note) come
   * from the install-wide bot with no footer to credit. Left as a bare Slack id
   * they read as a human — and, because the contract tells the agent that id is
   * how it gets tagged, as the agent itself.
   */
  it("names a footer-less bot post as the bot, not as the reading agent or a human", async () => {
    const h = harness();
    h.gw.setHistory([
      {
        ts: "0.1",
        user: "U-BOT",
        text: "The agent is still starting — hang on",
      },
      { ts: "0.2", user: "U999", text: "ok" },
    ]);

    await h.worker.connect();
    await h.gw.fireMention({
      user: "U999",
      channel: "C1",
      ts: "1.1",
      text: "hey agent",
    });

    const prompt = String(h.prompts[0]);
    expect(prompt).toContain(
      `the DAM bot (unattributed) [${formatSlackTs("0.1")}]: The agent is still starting`,
    );
    expect(prompt).not.toContain("U-BOT [");
    expect(prompt).not.toContain("you (this agent) [");
    expect(prompt).toContain('A line prefixed "the DAM bot (unattributed):"');
    expect(prompt).toContain("not yours unless you recognise it as your own");
  });

  /**
   * TEST_SCENARIO: The legend is an authorship key for prefixes only an agent's
   * own posts produce, so an all-human window has nothing for it to explain.
   */
  it("omits the authorship legend when history has no agent-authored messages", async () => {
    const h = harness();
    h.gw.setHistory([{ ts: "0.1", user: "U999", text: "just humans here" }]);

    await h.worker.connect();
    await h.gw.fireMention({
      user: "U999",
      channel: "C1",
      ts: "1.1",
      text: "hey agent",
    });

    const prompt = String(h.prompts[0]);
    expect(prompt).toContain(
      `U999 [${formatSlackTs("0.1")}]: just humans here`,
    );
    expect(prompt).not.toContain("In the conversation history below");
    expect(prompt).not.toContain("(this agent):");
    expect(prompt).not.toContain("(another agent)");
  });

  /**
   * TEST_SCENARIO: A thread is one conversation and is the context for the
   * answer; a channel window is several, and answering it is the failure to
   * prevent.
   */
  it("frames a channel window as several topics and a thread as one conversation", async () => {
    const channel = harness();
    channel.gw.setHistory([
      { ts: "0.1", user: "U999", text: "staging deploy is broken" },
      { ts: "0.2", user: "U888", text: "anyone up for lunch" },
    ]);
    await channel.worker.connect();
    await channel.gw.fireMention({
      user: "U999",
      channel: "C1",
      ts: "1.1",
      text: "hey agent",
    });

    const topLevel = String(channel.prompts[0]);
    expect(topLevel).toContain("not a single discussion");
    expect(topLevel).toContain("several separate topics may be interleaved");
    expect(topLevel).toContain("Answer what follows the history");

    const thread = harness();
    thread.gw.setHistory([
      { ts: "0.1", user: "U999", text: "staging deploy is broken" },
      { ts: "0.2", user: "U888", text: "rolled it back" },
    ]);
    await thread.worker.connect();
    await thread.gw.fireMention({
      user: "U999",
      channel: "C1",
      ts: "1.1",
      threadTs: "0.1",
      text: "hey agent",
    });

    const inThread = String(thread.prompts[0]);
    expect(inThread).toContain("the thread this turn was posted into");
    expect(inThread).toContain("Answer what follows the history");
    expect(inThread).not.toContain(
      "several separate topics may be interleaved",
    );
  });

  it("points the legend and the turn contract at describe_channel_users by default (scopes unknown)", async () => {
    const h = harness();
    h.gw.setHistory([
      {
        ts: "0.1",
        user: "U-BOT",
        text: "already looking into it",
        blocks: [
          agentContextBlock({
            uiBaseUrl: "http://ui",
            agentId: "agent-1",
            label: FOOTER_LABEL,
          }),
        ],
      },
    ]);

    await h.worker.connect();
    await h.gw.fireMention({
      user: "U999",
      channel: "C1",
      ts: "1.1",
      text: "hey agent",
    });

    const prompt = String(h.prompts[0]);
    expect(prompt).toContain(
      "call mcp__platform-outbound__describe_channel_users to find out who they are",
    );
    expect(prompt).toContain(
      'call mcp__platform-outbound__describe_channel_users with channel="slack"',
    );
  });

  it("drops the describe_channel_users pointer once the app's users:read scope is confirmed missing", async () => {
    const h = harness();
    h.gw.setGrantedScopes(["chat:write", "app_mentions:read"]);
    h.gw.setHistory([
      {
        ts: "0.1",
        user: "U-BOT",
        text: "already looking into it",
        blocks: [
          agentContextBlock({
            uiBaseUrl: "http://ui",
            agentId: "agent-1",
            label: FOOTER_LABEL,
          }),
        ],
      },
    ]);

    await h.worker.connect();
    await h.gw.fireMention({
      user: "U999",
      channel: "C1",
      ts: "1.1",
      text: "hey agent",
    });

    const prompt = String(h.prompts[0]);
    expect(prompt).toContain("you (this agent)");
    expect(prompt).not.toContain("describe_channel_users");
    expect(prompt).not.toContain("call describe_channel_users");
  });

  it("names the conversation as a shared channel or group DM, with a permalink, in a channel mention", async () => {
    const h = harness();

    await h.worker.connect();
    await h.gw.fireMention({
      user: "U999",
      channel: "C1",
      ts: "1.1",
      text: "hey agent",
    });

    const prompt = String(h.prompts[0]);
    expect(prompt).toContain("in a shared channel or group DM");
    expect(prompt).toContain(
      "permalink: https://fake-workspace.slack.com/archives/C1/p11",
    );
  });

  it("recognizes a 1:1 DM by the conversation id", async () => {
    const h = harness("D123");

    await h.worker.connect();
    await h.gw.fireDirectMessage({
      user: "U999",
      channel: "D123",
      ts: "1.1",
      text: "hey agent",
    });

    const prompt = String(h.prompts[0]);
    expect(prompt).toContain("in a 1:1 direct message");
    expect(prompt).not.toContain("shared channel or group DM");
  });

  it("omits the permalink clause when Slack can't resolve one, keeping the rest of the line", async () => {
    const h = harness();
    h.gw.getPermalink = async () => null;

    await h.worker.connect();
    await h.gw.fireMention({
      user: "U999",
      channel: "C1",
      ts: "1.1",
      text: "hey agent",
    });

    const prompt = String(h.prompts[0]);
    expect(prompt).toContain("in a shared channel or group DM");
    expect(prompt).not.toContain("permalink");
  });

  it("still relays the turn when the permalink lookup throws outright", async () => {
    const h = harness();
    h.gw.getPermalink = async () => {
      throw new Error("missing_scope");
    };

    await h.worker.connect();
    await h.gw.fireMention({
      user: "U999",
      channel: "C1",
      ts: "1.1",
      text: "hey agent",
    });

    expect(h.prompts).toHaveLength(1);
    const prompt = String(h.prompts[0]);
    expect(prompt).toContain("You're answering a message sent");
    expect(prompt).not.toContain("permalink");
  });
});
