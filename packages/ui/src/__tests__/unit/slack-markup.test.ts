import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SlackMarkup } from "../../modules/approvals/components/slack-markup.js";
import { parseSlackMarkup } from "../../modules/approvals/lib/slack-markup.js";

// TEST_OVERVIEW: a held Slack post shows its text as Slack will show it. The Slack message tools take standard markdown (bold, italic, strike, code, code blocks, lists, quotes, links) and Slack's own `<...>` references (links, user and channel mentions, @here), so the card reads the same marks. A mark the card does not know, or one that is not closed, shows as typed, and HTML in a message shows as text, never as markup.

const text = (value: string) => ({ kind: "text", text: value });
const paragraph = (...lines: unknown[][]) => ({ kind: "paragraph", lines });
const html = (value: string) =>
  renderToStaticMarkup(createElement(SlackMarkup, { text: value }));

describe("a Slack message as blocks", () => {
  // TEST_SCENARIO: the standup post from the design: a bold first line, a list with a user mention, and a closing line after a blank line.
  it("reads a heading line, a list and a paragraph", () => {
    expect(
      parseSlackMarkup(
        "**Standup, Tue 24 Nov**\n- Prototype is ready\n- Blocked: waiting for <@U04PETRA>\n\nFull notes are in the thread.",
      ),
    ).toEqual([
      paragraph([{ kind: "bold", children: [text("Standup, Tue 24 Nov")] }]),
      {
        kind: "list",
        ordered: false,
        start: 1,
        items: [
          [text("Prototype is ready")],
          [
            text("Blocked: waiting for "),
            { kind: "mention", label: "@U04PETRA" },
          ],
        ],
      },
      paragraph([text("Full notes are in the thread.")]),
    ]);
  });

  // TEST_SCENARIO: lines next to each other stay one paragraph with a line break, as in Slack; a blank line starts a new one.
  it("keeps line breaks inside a paragraph", () => {
    expect(parseSlackMarkup("one\ntwo\n\nthree")).toEqual([
      paragraph([text("one")], [text("two")]),
      paragraph([text("three")]),
    ]);
  });

  // TEST_SCENARIO: a numbered list keeps the number it starts at, a "> " line is a quote, and a fenced block keeps its text as written without the language name.
  it("reads numbered lists, quotes and code blocks", () => {
    expect(
      parseSlackMarkup(
        "3. third\n4. fourth\n> quoted *text*\n```ts\nconst a = **1**;\n```",
      ),
    ).toEqual([
      {
        kind: "list",
        ordered: true,
        start: 3,
        items: [[text("third")], [text("fourth")]],
      },
      {
        kind: "quote",
        lines: [
          [text("quoted "), { kind: "italic", children: [text("text")] }],
        ],
      },
      { kind: "code", text: "const a = **1**;" },
    ]);
  });
});

describe("marks inside a line", () => {
  // TEST_SCENARIO: every mark the Slack message tools know, side by side. A link labelled with its own address shows no second address, and a mention shows the id, whatever label the text gives it.
  it("reads bold, italic, strike, code, links and mentions", () => {
    expect(
      parseSlackMarkup(
        "_a_ *b* ~~c~~ `d` [x.dev](https://x.dev/) <https://y.dev> <mailto:a@b.dev> <#C123|launch-team> <#C456> <!here> <@U1|petra> <!subteam^S9|@team>",
      ),
    ).toEqual([
      paragraph([
        { kind: "italic", children: [text("a")] },
        text(" "),
        { kind: "italic", children: [text("b")] },
        text(" "),
        { kind: "strike", children: [text("c")] },
        text(" "),
        { kind: "code", text: "d" },
        text(" "),
        {
          kind: "link",
          url: "https://x.dev/",
          label: "x.dev",
          destination: null,
        },
        text(" "),
        {
          kind: "link",
          url: "https://y.dev",
          label: "https://y.dev",
          destination: null,
        },
        text(" "),
        {
          kind: "link",
          url: "mailto:a@b.dev",
          label: "a@b.dev",
          destination: null,
        },
        text(" "),
        { kind: "mention", label: "#C123" },
        text(" "),
        { kind: "mention", label: "#C456" },
        text(" "),
        { kind: "mention", label: "@here" },
        text(" "),
        { kind: "mention", label: "@U1" },
        text(" "),
        { kind: "mention", label: "@S9" },
      ]),
    ]);
  });

  // TEST_SCENARIO: the owner approves from what the card shows, so a link whose label is not its own address keeps the real address next to the label: the whole address when it is short, the host when it is long. A label that is itself another address cannot pass as the real one.
  it("shows where a link really goes", () => {
    const linkOf = (message: string) => parseSlackMarkup(message)[0];
    expect(linkOf("[https://docs.company.com](https://evil.example)")).toEqual(
      paragraph([
        {
          kind: "link",
          url: "https://evil.example",
          label: "https://docs.company.com",
          destination: "https://evil.example",
        },
      ]),
    );
    expect(
      linkOf(
        "<https://evil.example/a/very/long/path/that/hides/the/host?x=1|https://docs.company.com>",
      ),
    ).toEqual(
      paragraph([
        {
          kind: "link",
          url: "https://evil.example/a/very/long/path/that/hides/the/host?x=1",
          label: "https://docs.company.com",
          destination: "evil.example",
        },
      ]),
    );
    expect(linkOf("[notes](mailto:a@b.dev)")).toEqual(
      paragraph([
        {
          kind: "link",
          url: "mailto:a@b.dev",
          label: "notes",
          destination: "a@b.dev",
        },
      ]),
    );
  });

  // TEST_SCENARIO: a text that opens a mark again and again and never closes it is the worst case for the parser; 64 KiB of it still parses fast and shows as typed.
  it("parses a large hostile message fast", () => {
    const hostile = [
      "*a ".repeat(20_000),
      "_a ".repeat(20_000),
      "**a ".repeat(15_000),
      "[a](".repeat(15_000),
      "<a ".repeat(20_000),
      "`a ".repeat(20_000),
      "```\n".repeat(10_000),
      "*_~~**".repeat(10_000) + "a" + "**~~_*".repeat(10_000),
    ];
    for (const message of hostile) {
      const started = performance.now();
      const blocks = parseSlackMarkup(message);
      expect(performance.now() - started).toBeLessThan(1000);
      expect(blocks.length).toBeGreaterThan(0);
    }
    expect(parseSlackMarkup("*a ".repeat(20_000))).toEqual([
      paragraph([text("*a ".repeat(20_000))]),
    ]);
  });

  // TEST_SCENARIO: marks nest, so italic inside bold stays italic, and code shows its text as written, with no marks read inside it.
  it("nests marks and leaves code as written", () => {
    expect(parseSlackMarkup("**bold _and italic_** `*raw*`")).toEqual([
      paragraph([
        {
          kind: "bold",
          children: [
            text("bold "),
            { kind: "italic", children: [text("and italic")] },
          ],
        },
        text(" "),
        { kind: "code", text: "*raw*" },
      ]),
    ]);
  });

  // TEST_SCENARIO: a mark that is not closed, an underscore inside a word, an unknown `<...>` reference, a link to an address that is not http, https or mailto, a fence with no end, and an escaped star all show exactly as typed.
  it("shows broken and unknown marks as typed", () => {
    const typed = [
      "**not closed",
      "<@U123",
      "`open",
      "~~half",
      "snake_case_name",
      "<foo|bar>",
      "[x](javascript:alert(1))",
      "<javascript:alert(1)|click>",
      "# heading",
    ];
    for (const line of typed)
      expect(parseSlackMarkup(line)).toEqual([paragraph([text(line)])]);
    expect(parseSlackMarkup("```\nnever closed")).toEqual([
      paragraph([text("```")], [text("never closed")]),
    ]);
    expect(parseSlackMarkup("\\*not italic\\*")).toEqual([
      paragraph([text("*not italic*")]),
    ]);
  });
});

describe("the message on the card", () => {
  // TEST_SCENARIO: the card builds elements from the marks: bold, a list, a mention by its id and a link that opens in a new tab without access to the app, with its real address in brackets after a label that is not that address.
  it("renders the marks as elements", () => {
    const markup = html(
      "**Standup**\n- one <@U1|petra>\n- see <https://x.dev|notes>",
    );
    expect(markup).toContain('<strong class="font-semibold">Standup</strong>');
    expect(markup).toContain('<ul class="list-disc pl-5">');
    expect(markup).toContain(">@U1</span>");
    expect(markup).not.toContain("petra");
    expect(markup).toContain(
      '<a href="https://x.dev" target="_blank" rel="noopener noreferrer"',
    );
    expect(markup).toContain(
      'notes</a><span data-testid="slack-link-destination" class="text-muted-foreground"> (https://x.dev)</span>',
    );
  });

  // TEST_SCENARIO: a message that contains HTML shows that HTML as text: no tag from the message reaches the page.
  it("shows HTML in a message as text", () => {
    const markup = html(
      '<b>hi</b> <script>alert(1)</script>\n<img src=x onerror="alert(1)">',
    );
    expect(markup).not.toContain("<script>");
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("<b>");
    expect(markup).toContain(
      "&lt;b&gt;hi&lt;/b&gt; &lt;script&gt;alert(1)&lt;/script&gt;",
    );
    expect(markup).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });
});
