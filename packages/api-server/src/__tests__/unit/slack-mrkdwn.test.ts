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

  /**
   * TEST_SCENARIO: Slack renders each section alone. A code block longer than
   * one section, such as a log, must stay a code block in every piece, and a
   * cut must never split an escaped character such as `&amp;`, or the reader
   * sees raw markup.
   */
  it("keeps a long code block fenced in every section and its entities whole", () => {
    const lines = Array.from(
      { length: 200 },
      (_, i) => `line ${i} & <value> ${"x".repeat(20)}`,
    );
    const sections = texts(`\`\`\`\n${lines.join("\n")}\n\`\`\``);
    expect(sections.length).toBeGreaterThan(1);
    for (const section of sections) {
      expect(section.length).toBeLessThanOrEqual(3000);
      expect(section.startsWith("```\n")).toBe(true);
      expect(section.endsWith("\n```")).toBe(true);
      expect(section.split("```")).toHaveLength(3);
      for (const line of section.split("\n").slice(1, -1))
        expect(line).toMatch(/^line \d+ &amp; &lt;value&gt; x{20}$/);
    }
    expect(sections.flatMap((s) => s.split("\n").slice(1, -1))).toHaveLength(
      200,
    );
  });

  it("cuts a long line at a space, never inside an entity", () => {
    const sections = texts(Array.from({ length: 800 }, () => "a&b").join(" "));
    expect(sections.length).toBeGreaterThan(1);
    for (const section of sections)
      expect(section.trim()).toMatch(/^(a&amp;b ?)+$/);
  });

  it("cuts a code line longer than a section and still ends", () => {
    const sections = texts(`\`\`\`\n${"y".repeat(7000)}\n\`\`\``);
    expect(sections.every((s) => s.length <= 3000)).toBe(true);
    expect(sections.every((s) => s.split("```").length === 3)).toBe(true);
    expect(sections.join("").replace(/[`\n]/g, "")).toBe("y".repeat(7000));
  });

  it("emits mrkdwn section blocks", () => {
    expect(markdownToSections("hi")).toEqual([
      { type: "section", text: { type: "mrkdwn", text: "hi" } },
    ]);
  });
});
