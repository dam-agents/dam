/**
 * TEST_OVERVIEW: A Channel Card is the Slack Block Kit blocks an Agent sends
 * with a post. The platform does not render them: it checks them, derives
 * their text form, finds their link buttons and counts them. The check lets
 * any block and any element through. It writes its own `action_id` on every
 * button and field, because an interaction is routed by that id, and it
 * gives a field's value back under the name the Agent chose.
 */
import { describe, expect, it } from "vitest";
import {
  agentActionOf,
  channelBlockInteractive,
  channelFieldValues,
  channelBlockLinkButtons,
  channelBlocksText,
  checkChannelBlocks,
  countChannelBlocks,
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
   * TEST_SCENARIO: The Agent decides what its post holds, so a select, a
   * text input and an input block pass, wherever they sit. A field's value
   * comes back keyed by its identifier, so the platform's identifier keeps
   * the name the Agent gave it, or makes one from the element's type.
   */
  it("passes fields at any depth and keeps their names in the platform's id", () => {
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
                    accessory: {
                      type: "static_select",
                      action_id: "environment",
                      options: [],
                    },
                  },
                },
              ],
            },
          ],
        },
        {
          type: "input",
          label: { type: "plain_text", text: "Reason" },
          element: { type: "plain_text_input" },
        },
      ],
      { agentId: AGENT },
    );
    expect(result).toMatchObject({
      blocks: [
        {
          rows: [
            {
              items: [
                {
                  block: {
                    accessory: {
                      type: "static_select",
                      action_id: `agent-field:${AGENT}:environment`,
                    },
                  },
                },
              ],
            },
          ],
        },
        {
          type: "input",
          element: {
            type: "plain_text_input",
            action_id: `agent-field:${AGENT}:plain_text_input-1`,
          },
        },
      ],
    });
  });

  /**
   * TEST_SCENARIO: An element Slack adds later is not in the named set, but
   * an element that sends something carries an `action_id`. The platform
   * takes that identifier over too, so no element of an Agent's post reaches
   * Slack under an identifier the Agent chose, such as the private menu's.
   */
  it("takes over the id of an unknown element that carries one", () => {
    expect(
      checkChannelBlocks(
        [
          {
            type: "actions",
            elements: [{ type: "color_picker", action_id: "command-menu:0" }],
          },
        ],
        { agentId: AGENT },
      ),
    ).toEqual({
      blocks: [
        {
          type: "actions",
          elements: [
            {
              type: "color_picker",
              action_id: `agent-field:${AGENT}:command-menu:0`,
            },
          ],
        },
      ],
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
    expect(channelBlockInteractive(blocks)).toEqual(['the button "Approve"']);
    expect(agentActionOf(`agent-button:${AGENT}:0`)).toEqual({
      kind: "button",
      agentId: AGENT,
    });
    expect(agentActionOf(`agent-field:${AGENT}:a:b`)).toEqual({
      kind: "field",
      agentId: AGENT,
      name: "a:b",
    });
    expect(agentActionOf("command-menu:1")).toBeNull();
    expect(agentActionOf(`agent-link:${AGENT}:0`)).toBeNull();
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

describe("channelFieldValues", () => {
  /**
   * TEST_SCENARIO: Slack sends the state of a post's fields keyed by block
   * and by element identifier, each in the shape of its element. The Agent
   * gets one flat object under the names it chose, with plain values. A
   * field of another Agent, and an element the platform did not name, are
   * left out. Two fields that share a name are told apart by their block.
   */
  it("gives the Agent's fields by name, with plain values", () => {
    const field = (name: string) => `agent-field:${AGENT}:${name}`;
    expect(
      channelFieldValues(
        {
          b1: { [field("reason")]: { type: "plain_text_input", value: "ok" } },
          b2: {
            [field("region")]: {
              type: "static_select",
              selected_option: {
                text: { type: "plain_text", text: "EU west" },
                value: "eu-west",
              },
            },
          },
          b3: {
            [field("teams")]: {
              type: "multi_static_select",
              selected_options: [{ value: "a" }, { value: "b" }],
            },
            [field("day")]: { type: "datepicker", selected_date: "2026-11-17" },
            [field("empty")]: { type: "plain_text_input", value: null },
          },
          b4: { [field("reason")]: { type: "plain_text_input", value: "two" } },
          b5: {
            "agent-field:agent-other:secret": { type: "plain_text_input" },
            "command-menu:0": { type: "plain_text_input", value: "x" },
          },
        },
        AGENT,
      ),
    ).toEqual({
      reason: "ok",
      region: "eu-west",
      teams: ["a", "b"],
      day: "2026-11-17",
      empty: null,
      "b4.reason": "two",
    });
    expect(channelFieldValues(undefined, AGENT)).toEqual({});
  });
});

describe("channelBlockInteractive", () => {
  /**
   * TEST_SCENARIO: A private answer to a whisper can carry nothing a person
   * acts on, because an interaction with it cannot reach the Agent. The
   * elements that would need one are named, and a link button is not one.
   */
  it("names the choice buttons and the fields, not the link buttons", () => {
    expect(
      channelBlockInteractive([
        {
          type: "actions",
          elements: [
            { type: "button", text: { type: "plain_text", text: "Approve" } },
            {
              type: "button",
              text: { type: "plain_text", text: "Logs" },
              url: "https://example.com/logs",
            },
            { type: "static_select", options: [] },
          ],
        },
      ]),
    ).toEqual(['the button "Approve"', 'a "static_select" element']);
  });
});

describe("field names and values", () => {
  /**
   * TEST_SCENARIO: Slack lets two fields in different blocks share an
   * identifier, and then keys their values by a block identifier the Agent
   * never chose. The check gives a repeated name a number, in the order the
   * Agent wrote the fields, so every value comes back under a name the Agent
   * can predict.
   */
  it("numbers a repeated field name in the order of the post", () => {
    const text = (label: string) => ({
      type: "input",
      label: { type: "plain_text", text: label },
      element: { type: "plain_text_input", action_id: "value" },
    });
    expect(
      checkChannelBlocks([text("First"), text("Second"), text("Third")], {
        agentId: AGENT,
      }),
    ).toMatchObject({
      blocks: [
        { element: { action_id: `agent-field:${AGENT}:value` } },
        { element: { action_id: `agent-field:${AGENT}:value-2` } },
        { element: { action_id: `agent-field:${AGENT}:value-3` } },
      ],
    });
  });

  /**
   * TEST_SCENARIO: Some fields hold more than a plain value. Formatted text
   * comes as its text, an attached file as its name, because the file itself
   * does not reach the Agent, and a field of a kind the platform does not
   * know as what Slack sent for it. A field named like a built-in property
   * of an object is a field like any other.
   */
  it("reads formatted text, file names, unknown fields and odd names", () => {
    const field = (name: string) => `agent-field:${AGENT}:${name}`;
    expect(
      channelFieldValues(
        {
          b1: {
            [field("notes")]: {
              type: "rich_text_input",
              rich_text_value: {
                type: "rich_text",
                elements: [
                  {
                    type: "rich_text_section",
                    elements: [{ type: "text", text: "Ship it" }],
                  },
                ],
              },
            },
            [field("proof")]: {
              type: "file_input",
              files: [{ id: "F1", name: "report.pdf", url_private: "x" }],
            },
            [field("shade")]: { type: "color_picker", color: "#ff0000" },
            [field("constructor")]: { type: "plain_text_input", value: "c" },
            [field("__proto__")]: { type: "plain_text_input", value: "p" },
          },
        },
        AGENT,
      ),
    ).toEqual(
      Object.fromEntries([
        ["notes", "Ship it"],
        ["proof", ["report.pdf"]],
        ["shade", { color: "#ff0000" }],
        ["constructor", "c"],
        ["__proto__", "p"],
      ]),
    );
  });
});
