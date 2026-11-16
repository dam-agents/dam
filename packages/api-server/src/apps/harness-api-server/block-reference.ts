import type { ChannelBlock } from "../../modules/channels/domain/channel-blocks.js";

export interface BlockReference {
  type: string;
  purpose: string;
  fields: string;
  example?: ChannelBlock;
}

export interface BlockExample {
  shows: string;
  blocks: ChannelBlock[];
}

const tile = (title: string, value: string, footer: string): ChannelBlock => ({
  type: "card",
  title: { type: "plain_text", text: title },
  body: { type: "mrkdwn", text: value },
  subtext: { type: "mrkdwn", text: footer },
});

const COST_CHART: ChannelBlock = {
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
    axis_config: { categories: ["W44", "W45"], y_label: "USD" },
  },
};

const REASON_FIELD: ChannelBlock = {
  type: "input",
  label: { type: "plain_text", text: "Reason" },
  optional: true,
  element: {
    type: "plain_text_input",
    action_id: "reason",
    multiline: true,
  },
};

const REGION_FIELD: ChannelBlock = {
  type: "input",
  label: { type: "plain_text", text: "Region" },
  element: {
    type: "static_select",
    action_id: "region",
    options: [
      { text: { type: "plain_text", text: "EU west" }, value: "eu-west" },
      { text: { type: "plain_text", text: "US east" }, value: "us-east" },
    ],
  },
};

export const BLOCK_REFERENCE: BlockReference[] = [
  {
    type: "layout",
    purpose:
      "Puts blocks side by side: rows of one to three items. On a phone the items of a row stack.",
    fields:
      'label: required string, at most 150 characters, shown only with is_label_visible: true. rows: 1 to 5, each { items: 1 to 3 }. Each item: { block, width: "narrow" | "standard" | "wide", horizontal_alignment: "start" | "center" | "end" }; widths share the row as 1 : 2 : 3. grid_lines: "none" | "rows" | "outer". fallback: blocks for a client that cannot show a layout (context, divider, header, image, rich_text, section, table, video). A chart must take more than half of its row. A chart, a data table and a carousel do not share a row. A layout may hold a container and a container a layout, and no deeper.',
    example: {
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
    },
  },
  {
    type: "card",
    purpose:
      "A tile: a title, a subtitle, a main line and a muted line under it.",
    fields:
      "title, subtitle: text objects, at most 150 characters. body, subtext: text objects, at most 200 characters; subtext shows under body. icon or hero_image: an image element. actions: at most 3 buttons. At least one of hero_image, title, body or actions.",
    example: tile("Cost", "*$1 240*", "-8 % week on week"),
  },
  {
    type: "container",
    purpose:
      "A titled group of blocks, which can collapse. Use it for a text panel beside a chart.",
    fields:
      'title: required plain_text, at most 150 characters. subtitle: a text object. child_blocks: required, at most 10 blocks (actions, context, divider, header, image, layout, rich_text, section, table, video). width: "narrow" | "standard" | "wide" | "full". is_collapsible, default_collapsed, has_header_divider: booleans. icon: an image element.',
    example: {
      type: "container",
      title: { type: "plain_text", text: "What moved" },
      child_blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: "Cost fell after the cache change." },
        },
      ],
    },
  },
  {
    type: "carousel",
    purpose: "A row of cards the reader scrolls sideways.",
    fields: "elements: 1 to 10 card blocks.",
  },
  {
    type: "table",
    purpose: "A table with a header row.",
    fields:
      'rows: at most 100, each a list of at most 20 cells. A cell: { type: "raw_text", text } or { type: "rich_text", elements }. column_settings: per column { align: "left" | "center" | "right", is_wrapped }. All cells of a message hold at most 10000 characters.',
    example: {
      type: "table",
      rows: [
        [
          { type: "raw_text", text: "Week" },
          { type: "raw_text", text: "Cost" },
        ],
        [
          { type: "raw_text", text: "W45" },
          { type: "raw_text", text: "$1 240" },
        ],
      ],
    },
  },
  {
    type: "data_visualization",
    purpose: "A chart: bar, line, area or pie.",
    fields:
      'title: required string, at most 50 characters. chart for a pie: { type: "pie", segments: 1 to 12 of { label, value above 0 } }. chart for the others: { type: "bar" | "line" | "area", series: 1 to 12 of { name, data: 1 to 20 of { label, value } }, axis_config: { categories, x_label, y_label } }. Labels and names hold at most 20 characters. Each series has one point per category, and a point\'s label is a category. A message holds at most 2 charts.',
    example: COST_CHART,
  },
  {
    type: "header",
    purpose: "A heading between groups of blocks.",
    fields: "text: plain_text, at most 150 characters.",
  },
  {
    type: "section",
    purpose: "A paragraph, with optional label and value pairs.",
    fields:
      "text: a text object, at most 3000 characters. fields: at most 10 text objects of at most 2000 characters, shown in two columns. accessory: one element, such as an image or a button.",
  },
  {
    type: "context",
    purpose: "A small muted line.",
    fields: "elements: at most 10 text objects or images.",
  },
  {
    type: "divider",
    purpose: "A line between blocks.",
    fields: "No fields.",
  },
  {
    type: "image",
    purpose: "A picture inside the post.",
    fields: "image_url: a public HTTPS address. alt_text: required.",
  },
  {
    type: "actions",
    purpose: "A row of buttons.",
    fields:
      'elements: at most 25 buttons, select menus or other elements. A button: { type: "button", text: plain_text, url } opens a page; without url its click reaches you and may carry a value of at most 2000 characters.',
    example: {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Open the dashboard" },
          url: "https://example.com/dashboard",
        },
      ],
    },
  },
  {
    type: "input",
    purpose:
      "A labelled field of a form. Its value reaches you with the click on a button of the same post.",
    fields:
      "label: required plain_text, at most 2000 characters. element: required, one field such as plain_text_input, number_input, static_select, checkboxes, radio_buttons or datepicker. hint: plain_text, at most 2000 characters. optional: boolean. dispatch_action: boolean; true sends each change at once in place of waiting for a button.",
    example: REASON_FIELD,
  },
  {
    type: "plain_text_input",
    purpose: "A text field. It goes only in an input block.",
    fields:
      "action_id: the name its value comes back under. initial_value: string. multiline: boolean. min_length: 0 to 3000. max_length: 1 to 3000. placeholder: plain_text, at most 150 characters.",
  },
  {
    type: "static_select",
    purpose:
      "A select menu. It goes in an input block, in an actions block, or beside a section as its accessory.",
    fields:
      "action_id: the name its value comes back under. options: at most 100 of { text: plain_text, value }. initial_option: one of the options. placeholder: plain_text, at most 150 characters. You get the selected option's value.",
    example: REGION_FIELD,
  },
];

export const BLOCK_EXAMPLES: BlockExample[] = [
  {
    shows: "Three KPI tiles side by side under a heading.",
    blocks: [
      { type: "header", text: { type: "plain_text", text: "This week" } },
      {
        type: "layout",
        label: "KPI",
        rows: [
          {
            items: [
              { block: tile("Cost", "*$1 240*", "-8 % week on week") },
              { block: tile("Sessions", "*312*", "+14 % week on week") },
              { block: tile("Failed runs", "*3*", "2 fewer than last week") },
            ],
          },
        ],
      },
    ],
  },
  {
    shows: "A chart beside a text panel that has its own link button.",
    blocks: [
      {
        type: "layout",
        label: "Cost",
        rows: [
          {
            items: [
              { width: "wide", block: COST_CHART },
              {
                width: "narrow",
                block: {
                  type: "container",
                  title: { type: "plain_text", text: "What moved" },
                  child_blocks: [
                    {
                      type: "section",
                      text: {
                        type: "mrkdwn",
                        text: "Cost fell 8 % after the cache change.",
                      },
                    },
                    {
                      type: "actions",
                      elements: [
                        {
                          type: "button",
                          text: { type: "plain_text", text: "Open the report" },
                          url: "https://example.com/report",
                        },
                      ],
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
  },
  {
    shows:
      "A form: two fields and a button. The click brings both values, as region and reason.",
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: "Deploy *2.4*?" },
      },
      REGION_FIELD,
      REASON_FIELD,
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Deploy" },
            style: "primary",
            value: "deploy",
          },
          {
            type: "button",
            text: { type: "plain_text", text: "Cancel" },
            value: "cancel",
          },
        ],
      },
    ],
  },
];
