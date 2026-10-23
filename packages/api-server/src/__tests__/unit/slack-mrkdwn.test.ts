import { describe, it, expect } from "vitest";
import { markdownToSections } from "../../modules/channels/infrastructure/slack-mrkdwn.js";

/**
 * TEST_OVERVIEW: An agent post that carries a file is shared by Slack's file
 * upload, which refuses a `markdown` block. The agent's Markdown is converted
 * to mrkdwn `section` blocks for it instead. These specs pin that the text
 * reads the same as the `markdown` block would show it, that mrkdwn markup is
 * escaped while Slack mentions keep working, and that Slack's 3000-character
 * limit per section is kept.
 */

const texts = (markdown: string) =>
  markdownToSections(markdown).map(
    (block) => (block.text as { text: string }).text,
  );

describe("markdownToSections", () => {
  it("converts inline formatting to mrkdwn", () => {
    expect(
      texts("**bold**, _em_, ~~gone~~, `code` and [docs](https://x.example/a)"),
    ).toEqual(["*bold*, _em_, ~gone~, `code` and <https://x.example/a|docs>"]);
  });

  it("keeps headings, lists, quotes and code blocks apart", () => {
    expect(
      texts(
        "## Result\n\n- one\n- two\n  - nested\n\n1. first\n2. second\n\n> quoted\n\n```ts\nconst a = 1 < 2;\n```",
      ),
    ).toEqual([
      "*Result*\n\n• one\n• two\n    • nested\n\n1. first\n2. second\n\n> quoted\n\n```\nconst a = 1 &lt; 2;\n```",
    ]);
  });

  it("renders a table as a code block", () => {
    const [text] = texts("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(text).toMatch(/^```\n[\s\S]*a[\s\S]*b[\s\S]*1[\s\S]*2[\s\S]*\n```$/);
  });

  /**
   * TEST_SCENARIO: mrkdwn reads `&`, `<` and `>` as markup, so plain text that
   * holds them would lose characters or turn into a broken link. A mention the
   * agent wrote in Slack's own form must still notify, so it is kept.
   */
  it("escapes markup characters but keeps Slack mentions", () => {
    expect(texts("Ask <@U123> in <#C456> or <!here>: a < b & c > d")).toEqual([
      "Ask <@U123> in <#C456> or <!here>: a &lt; b &amp; c &gt; d",
    ]);
  });

  /**
   * TEST_SCENARIO: Slack refuses a section whose text is longer than 3000
   * characters. Long text is split between paragraphs where it can be, and a
   * single paragraph longer than the limit is cut, so nothing is lost.
   */
  it("splits long text into sections of at most 3000 characters", () => {
    const paragraph = "a".repeat(2000);
    const huge = "b".repeat(7000);
    const sections = texts(`${paragraph}\n\n${paragraph}\n\n${huge}`);
    expect(sections.every((s) => s.length <= 3000)).toBe(true);
    expect(sections[0]).toBe(paragraph);
    expect(sections.join("").replace(/\s/g, "")).toBe(
      `${paragraph}${paragraph}${huge}`,
    );
  });

  it("emits mrkdwn section blocks", () => {
    expect(markdownToSections("hi")).toEqual([
      { type: "section", text: { type: "mrkdwn", text: "hi" } },
    ]);
  });
});
