import { describe, it, expect } from "vitest";
import { configureLogger } from "../../core/logger.js";
import {
  SLACK_HARNESS_OWNER,
  slackWorkerHarness,
} from "../helpers/slack-worker.js";

/**
 * TEST_OVERVIEW: The slash command with no text answers with a private menu,
 * an ephemeral message that lists the conversation's Agents and offers the
 * commands as buttons and as items under a "more" control. A control runs the
 * command whose text it carries, and the command's reply then takes the
 * menu's place, so the menu is gone once an action is done. A person sees
 * only the controls for actions they may take.
 */

configureLogger({ level: "error", write: () => {} });

interface Control {
  action_id: string;
  text?: { text: string };
  value?: string;
  options?: { text: { text: string }; value: string }[];
}

async function openMenu(opts: { linkedSub?: string; agentName?: string } = {}) {
  const h = slackWorkerHarness({
    ...(opts.linkedSub ? { linkedSub: opts.linkedSub } : {}),
    ...(opts.agentName ? { agentNames: { "agent-1": opts.agentName } } : {}),
  });
  await h.worker.connect();
  await h.gw.fireCommand({ text: "", userId: "U-1", channelId: "C1" });
  const choices = () =>
    (h.gw.readCommandMessage()?.blocks ?? [])
      .filter((block) => block["type"] === "actions")
      .flatMap((block) => block["elements"] as Control[])
      .flatMap((control) =>
        control.options
          ? control.options.map((option) => ({
              actionId: control.action_id,
              label: option.text.text,
              value: option.value,
            }))
          : [
              {
                actionId: control.action_id,
                label: control.text?.text ?? "",
                value: control.value ?? "",
              },
            ],
      );
  const click = async (label: string) => {
    const choice = choices().find((c) => c.label === label);
    if (!choice) throw new Error(`no control ${label}`);
    await h.gw.fireMessageAction({
      actionId: choice.actionId,
      value: choice.value,
      userId: "U-1",
      channelId: "C1",
    });
  };
  const labels = () => choices().map((c) => c.label);
  const text = () => JSON.stringify(h.gw.readCommandMessage()?.blocks);
  return { ...h, click, labels, text };
}

describe("slack command menu", () => {
  /**
   * TEST_SCENARIO: a person with no linked account may not change an Agent, so
   * the menu leaves those controls out and points at the login instead.
   */
  it("offers a person with no linked account only what they may do", async () => {
    const menu = await openMenu();

    expect(menu.labels()).toEqual([
      "Whisper",
      "Add an agent",
      "Close",
      "Ignored apps",
      "All commands",
      "Log in",
    ]);
    expect(menu.text()).toContain("Log in, under ⋯");
  });

  /**
   * TEST_SCENARIO: an item under "more" does what the typed command does, and
   * the menu gives way to the command's reply, with no controls left.
   */
  it("runs the command behind a menu item and leaves only its reply", async () => {
    const menu = await openMenu({ linkedSub: SLACK_HARNESS_OWNER });

    await menu.click("Read past messages · off");

    expect(menu.historyCalls).toEqual([
      { agentId: "agent-1", channelId: "C1", history: true },
    ]);
    expect(menu.text()).toContain("Channel history turned on");
    expect(menu.labels()).toEqual([]);
  });

  /**
   * TEST_SCENARIO: Whisper opens the private thread in the person's direct
   * messages. The typed command reads a last word of `on` or `off` as the
   * owner's whisper switch, so an Agent whose name ends in one must still get
   * a thread from the button.
   */
  it("opens a private whisper thread for an agent whose name ends in off", async () => {
    const menu = await openMenu({ agentName: "Sign off" });

    await menu.click("Whisper");

    expect(menu.text()).toContain("Opened a whisper with `Sign off`");
  });

  /**
   * TEST_SCENARIO: Disconnect asks first, because an item under "more" cannot
   * carry its own confirmation. The Agent stays connected until the person
   * confirms on the next screen.
   */
  it("disconnects only after the person confirms", async () => {
    const unbound: string[] = [];
    const h = slackWorkerHarness({
      linkedSub: SLACK_HARNESS_OWNER,
      unbindSlackChannel: async (agentId) => {
        unbound.push(agentId);
      },
    });
    await h.worker.connect();
    await h.gw.fireCommand({ text: "", userId: "U-1", channelId: "C1" });
    const act = (value: string) =>
      h.gw.fireMessageAction({
        actionId: "command_menu:0",
        value,
        userId: "U-1",
        channelId: "C1",
      });

    await act("menu:disconnect Helper");
    expect(unbound).toEqual([]);
    const confirm = JSON.stringify(h.gw.readCommandMessage()?.blocks);
    expect(confirm).toContain("unbind Helper");

    await act("unbind Helper");
    expect(unbound).toEqual(["agent-1"]);
  });
});
