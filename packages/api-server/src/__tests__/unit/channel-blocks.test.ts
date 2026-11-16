/**
 * TEST_OVERVIEW: A Channel Card is the Slack Block Kit blocks an Agent sends
 * with a post. The platform does not render them: it checks them, derives
 * their text form, finds their link buttons and counts them. The check lets
 * any block through, refuses an element whose answer cannot reach the Agent,
 * and writes its own `action_id` on every button, because a click is routed
 * by that id.
 */
import { describe, expect, it } from "vitest";
import {
  agentButtonAgent,
  channelBlockChoiceButtons,
  channelBlockLinkButtons,
  channelBlocksText,
  checkChannelBlocks,
  countChannelBlocks,
  withChoiceMade,
  type ChannelBlock,
} from "../../modules/channels/domain/channel-blocks.js";

const AGENT = "agent-677ca492fbca62dd";

const tile = (title: string, value: string, footer: string): ChannelBlock => ({
  type: "card",
  title: { type: "plain_text", text: title },
  body: { type: "mrkdwn", text: value },
  subtext: { type: "mrkdwn", text: footer },
});

const KPI_TILES: ChannelBlock[] = [
  {
    type: "layout",
    label: "KPI",
    rows: [
      {
        items: [
          { block: tile("Cost", "*$1 240*", "-8 % week on week") },
          { block: tile("Sessions", "*312*", "+14 % week on week") },
        ],
      },
    ],
    fallback: [
      { type: "section", text: { type: "mrkdwn", text: "Cost $1 240" } },
    ],
  },
];

describe("checkChannelBlocks", () => {
  /**
   * TEST_SCENARIO: The layout the feature exists for. Two tiles side by side
   * hold no element that needs an answer, so the blocks pass as written.
   */
  it("passes a layout of tiles unchanged", () => {
    expect(
      checkChannelBlocks(KPI_TILES, {
        agentId: AGENT,
      }),
    ).toEqual({ blocks: KPI_TILES });
  });

  /**
   * TEST_SCENARIO: Slack adds blocks over time. A block type the platform has
   * never seen must pass, or every new block would wait for a release.
   */
  it("passes a block type it does not know", () => {
    const blocks = [
      { type: "timeline", title: { type: "plain_text", text: "Rollout" } },
    ];
    expect(checkChannelBlocks(blocks, { agentId: AGENT })).toEqual({ blocks });
  });

  /**
   * TEST_SCENARIO: A select has no way to send its value to the Agent. It is
   * refused wherever it sits, here as a section's accessory inside a layout
   * item, and the issue names it.
   */
  it("refuses an input element at any depth", () => {
    const result = checkChannelBlocks(
      [
        {
          type: "layout",
          label: "Pick",
          rows: [
            {
              items: [
                {
                  block: {
                    type: "section",
                    text: { type: "mrkdwn", text: "Environment" },
                    accessory: { type: "static_select", options: [] },
                  },
                },
              ],
            },
          ],
        },
      ],
      { agentId: AGENT },
    );
    expect(result).toEqual({
      issues: [expect.stringContaining('"static_select" element')],
    });
  });

  /**
   * TEST_SCENARIO: An element Slack adds later is not in the named set, but
   * an element that sends something carries an `action_id`. That id on
   * anything but a button is enough to refuse it.
   */
  it("refuses an unknown element that carries an action_id", () => {
    const result = checkChannelBlocks(
      [
        {
          type: "actions",
          elements: [{ type: "color_picker", action_id: "pick" }],
        },
      ],
      { agentId: AGENT },
    );
    expect(result).toEqual({
      issues: [expect.stringContaining('"color_picker" element')],
    });
  });

  /**
   * TEST_SCENARIO: A private answer to a whisper is ephemeral, and a click on
   * an ephemeral message runs a command of the private menu when its
   * `action_id` has the menu's prefix. So the id and the value an Agent
   * writes on a link button must never reach Slack.
   */
  it("writes its own id on a link button and drops the value", () => {
    const result = checkChannelBlocks(
      [
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Open the PR" },
              url: "https://example.com/pr/1",
              action_id: "command-menu:0",
              value: "unbind reviewer",
            },
          ],
        },
      ],
      { agentId: AGENT },
    );
    expect(result).toEqual({
      blocks: [
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Open the PR" },
              url: "https://example.com/pr/1",
              action_id: `agent-link:${AGENT}:0`,
            },
          ],
        },
      ],
    });
  });

  /**
   * TEST_SCENARIO: A button with no url sends a choice back, and a click on
   * it reaches the Agent. It keeps the Agent's value, which the click hands
   * back as data, but never the Agent's id: the platform's id names the
   * Agent, so a click finds it without reading the post.
   */
  it("keeps a choice button's value under the platform's id", () => {
    const blocks = [
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Approve" },
            action_id: "command-menu:1",
            value: "approve",
          },
        ],
      },
    ];
    expect(channelBlockChoiceButtons(blocks)).toEqual(["Approve"]);
    expect(agentButtonAgent(`agent-button:${AGENT}:0`)).toBe(AGENT);
    expect(agentButtonAgent("command-menu:1")).toBeNull();
    expect(agentButtonAgent(`agent-link:${AGENT}:0`)).toBeNull();
    expect(checkChannelBlocks(blocks, { agentId: AGENT })).toEqual({
      blocks: [
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Approve" },
              action_id: `agent-button:${AGENT}:0`,
              value: "approve",
            },
          ],
        },
      ],
    });
  });

  /**
   * TEST_SCENARIO: An Agent that passes something else than a list of blocks
   * gets one issue that shows what a block is, not a crash.
   */
  it("refuses input that is not a list of blocks", () => {
    for (const input of [undefined, [], "text", [{ text: "no type" }]])
      expect(checkChannelBlocks(input, { agentId: AGENT })).toEqual({
        issues: [expect.stringContaining("non-empty list")],
      });
  });
});

describe("channelBlocksText", () => {
  /**
   * TEST_SCENARIO: The text form is what a notification, Telegram and the
   * history show. Every number of the tiles must be in it, in reading order.
   * The layout's label is hidden and its fallback repeats the content, so
   * neither is read.
   */
  it("reads tiles in order and leaves the fallback out", () => {
    expect(channelBlocksText(KPI_TILES)).toBe(
      [
        "Cost",
        "*$1 240*",
        "-8 % week on week",
        "Sessions",
        "*312*",
        "+14 % week on week",
      ].join("\n"),
    );
  });

  /**
   * TEST_SCENARIO: A table and a chart hold the numbers people ask for. The
   * text form keeps each row and each series on its own line.
   */
  it("reads a table row by row and a chart series by series", () => {
    expect(
      channelBlocksText([
        {
          type: "table",
          rows: [
            [
              { type: "raw_text", text: "Week" },
              { type: "raw_text", text: "Cost" },
            ],
            [
              { type: "raw_text", text: "45" },
              { type: "raw_number", value: 1240 },
            ],
          ],
        },
        {
          type: "data_visualization",
          title: "Cost per week",
          chart: {
            type: "bar",
            series: [
              {
                name: "Cost",
                data: [
                  { label: "W44", value: 1350 },
                  { label: "W45", value: 1240 },
                ],
              },
            ],
            axis_config: { categories: ["W44", "W45"] },
          },
        },
      ]),
    ).toBe(
      [
        "Week | Cost",
        "45 | 1240",
        "Cost per week",
        "Cost: W44 1350, W45 1240",
      ].join("\n"),
    );
  });

  /**
   * TEST_SCENARIO: A link button reads as a Markdown link on its own line,
   * the choice buttons of one group as one line of options, and a link in
   * Slack's own form as a Markdown link.
   */
  it("reads buttons and links", () => {
    expect(
      channelBlocksText([
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "Deploy <https://example.com/b|build 7>?",
          },
        },
        {
          type: "actions",
          elements: [
            { type: "button", text: { type: "plain_text", text: "Approve" } },
            { type: "button", text: { type: "plain_text", text: "Reject" } },
            {
              type: "button",
              text: { type: "plain_text", text: "Open the PR" },
              url: "https://example.com/pr/1",
            },
          ],
        },
      ]),
    ).toBe(
      [
        "Deploy [build 7](https://example.com/b)?",
        "Approve / Reject",
        "[Open the PR](https://example.com/pr/1)",
      ].join("\n"),
    );
  });

  /**
   * TEST_SCENARIO: Slack reads the `text` of a message as its own markup, in
   * which a link is `<url|label>`. The text form for that field keeps the
   * links as Slack writes them, so a notification shows a link and not
   * Markdown source, and the history reader can match the text against the
   * blocks.
   */
  it("keeps links in Slack's form when asked", () => {
    expect(
      channelBlocksText(
        [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "See <https://example.com/b|build 7>",
            },
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "Open the PR" },
                url: "https://example.com/pr/1",
              },
            ],
          },
        ],
        "slack",
      ),
    ).toBe(
      "See <https://example.com/b|build 7>\n<https://example.com/pr/1|Open the PR>",
    );
  });

  /**
   * TEST_SCENARIO: A block type the platform does not know still gives its
   * text objects to the text form, so nothing an Agent posted is lost from
   * the history.
   */
  it("reads the text of a block type it does not know", () => {
    expect(
      channelBlocksText([
        {
          type: "timeline",
          title: { type: "plain_text", text: "Rollout" },
          steps: [{ text: { type: "mrkdwn", text: "Canary at 10 %" } }],
        },
      ]),
    ).toBe("Rollout\nCanary at 10 %");
  });
});

describe("channelBlockLinkButtons", () => {
  /**
   * TEST_SCENARIO: Telegram shows a link button as its own button. Link
   * buttons are found at any depth, in order, and a choice button is not one.
   */
  it("finds link buttons at any depth", () => {
    expect(
      channelBlockLinkButtons([
        {
          type: "card",
          title: { type: "plain_text", text: "Build 7" },
          actions: [
            { type: "button", text: { type: "plain_text", text: "Approve" } },
            {
              type: "button",
              text: { type: "plain_text", text: "Logs" },
              url: "https://example.com/logs",
            },
          ],
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: "More" },
          accessory: {
            type: "button",
            text: { type: "plain_text", text: "Dashboard" },
            url: "https://example.com/dash",
          },
        },
      ]),
    ).toEqual([
      { label: "Logs", url: "https://example.com/logs" },
      { label: "Dashboard", url: "https://example.com/dash" },
    ]);
  });
});

describe("countChannelBlocks", () => {
  /**
   * TEST_SCENARIO: Slack counts nested blocks toward its limit per message.
   * A layout of two tiles is three blocks, and its fallback is not counted.
   */
  it("counts nested blocks", () => {
    expect(countChannelBlocks(KPI_TILES)).toBe(3);
    expect(
      countChannelBlocks([
        {
          type: "container",
          title: { type: "plain_text", text: "Details" },
          child_blocks: [{ type: "divider" }, ...KPI_TILES],
        },
      ]),
    ).toBe(5);
  });
});

describe("withChoiceMade", () => {
  const choice = (label: string) => ({
    type: "button",
    text: { type: "plain_text", text: label },
    value: label,
  });
  const link = {
    type: "button",
    text: { type: "plain_text", text: "Logs" },
    url: "https://example.com/logs",
  };
  const footer = {
    type: "context",
    elements: [{ type: "mrkdwn", text: "Sent by an agent" }],
  };

  /**
   * TEST_SCENARIO: A post takes one answer. After it, every choice button
   * goes, wherever it sits: in a tile inside a layout, in a row of its own,
   * as a section's accessory. A link button stays. The line that names the
   * choice goes before the last block, because the Agent Footer must stay
   * the block that ends the post.
   */
  it("removes choice buttons at any depth and names the choice before the footer", () => {
    const blocks: ChannelBlock[] = [
      {
        type: "layout",
        label: "Deploy",
        rows: [
          {
            items: [
              {
                block: {
                  type: "card",
                  title: { type: "plain_text", text: "Build 7" },
                  actions: [choice("Approve"), link],
                },
              },
              { block: { type: "actions", elements: [choice("Later")] } },
            ],
          },
        ],
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: "Or decide here" },
        accessory: choice("Reject"),
      },
      { type: "actions", elements: [choice("Skip")] },
      footer,
    ];

    expect(withChoiceMade(blocks, "<@U1> chose: Approve")).toEqual([
      {
        type: "layout",
        label: "Deploy",
        rows: [
          {
            items: [
              {
                block: {
                  type: "card",
                  title: { type: "plain_text", text: "Build 7" },
                  actions: [link],
                },
              },
            ],
          },
        ],
      },
      { type: "section", text: { type: "mrkdwn", text: "Or decide here" } },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: "<@U1> chose: Approve" }],
      },
      footer,
    ]);
    expect(
      channelBlockChoiceButtons(withChoiceMade(blocks, "<@U1> chose: Approve")),
    ).toEqual([]);
  });
});
