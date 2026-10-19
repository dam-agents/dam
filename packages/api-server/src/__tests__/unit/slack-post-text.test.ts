/**
 * TEST_OVERVIEW: renderSlackPostText gives the readable text of a Slack post.
 * Apps and incoming webhooks often send an empty `text` and put the content
 * in legacy `attachments[]` or in `blocks`, so that content must reach the
 * Agent. A person's post and an Agent's post carry a copy of their `text` in
 * `blocks`, so they must read exactly as before.
 */
import { describe, expect, it } from "vitest";
import { renderSlackPostText } from "../../modules/channels/infrastructure/slack-post-text.js";

const GITHUB_APP_POST = {
  text: "",
  attachments: [
    {
      fallback:
        "[dam-agents/dam] Pull request opened: #5412 fix(slack): read app posts",
      pretext: "Pull request opened by octocat",
      title: "#5412 fix(slack): read app posts",
      text: "Apps put their content in attachments.",
      fields: [
        { title: "Reviewers", value: "code-guardian" },
        { title: "Labels", value: "" },
      ],
      footer: "<https://github.com/dam-agents/dam|dam-agents/dam>",
    },
  ],
};

const WEBHOOK_BLOCK_POST = {
  text: "Deploy finished",
  blocks: [
    { type: "header", text: { type: "plain_text", text: "Deploy finished" } },
    {
      type: "section",
      text: { type: "mrkdwn", text: "*api-server* is live on *prod*" },
      fields: [
        { type: "mrkdwn", text: "*Version:* 5.4.1" },
        { type: "mrkdwn", text: "*Took:* 3 min" },
      ],
    },
    { type: "divider" },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: "Triggered by the release pipeline" }],
    },
  ],
};

describe("renderSlackPostText", () => {
  /**
   * TEST_SCENARIO: The case from the bug report. The GitHub app posts with an
   * empty `text`, and everything is in one legacy attachment. The fallback
   * only repeats the title, and an empty field value is no content.
   */
  it("reads a GitHub-app post from its attachments", () => {
    expect(renderSlackPostText(GITHUB_APP_POST)).toBe(
      [
        "Pull request opened by octocat",
        "#5412 fix(slack): read app posts",
        "Apps put their content in attachments.",
        "Reviewers: code-guardian",
        "<https://github.com/dam-agents/dam|dam-agents/dam>",
      ].join("\n"),
    );
  });

  /**
   * TEST_SCENARIO: A block-kit webhook sets `text` to a short notification
   * fallback. The header only repeats it, and the section, its fields and the
   * context line follow it.
   */
  it("adds a webhook's block content after its fallback text", () => {
    expect(renderSlackPostText(WEBHOOK_BLOCK_POST)).toBe(
      [
        "Deploy finished",
        "*api-server* is live on *prod*\n*Version:* 5.4.1\n*Took:* 3 min",
        "Triggered by the release pipeline",
      ].join("\n"),
    );
  });

  it("uses the attachment fallback when it is all there is", () => {
    expect(
      renderSlackPostText({ attachments: [{ fallback: "Build #12 failed" }] }),
    ).toBe("Build #12 failed");
  });

  /**
   * TEST_SCENARIO: A Slack client writes a `rich_text` copy of the text of
   * every post a person writes. The line must stay the text alone.
   */
  it("leaves a person's post as its text", () => {
    expect(
      renderSlackPostText({
        text: "can you look at <#C1>?",
        blocks: [
          {
            type: "rich_text",
            elements: [
              {
                type: "rich_text_section",
                elements: [
                  { type: "text", text: "can you look at " },
                  { type: "channel", channel_id: "C1" },
                  { type: "text", text: "?" },
                ],
              },
            ],
          },
        ],
      }),
    ).toBe("can you look at <#C1>?");
  });

  it("reads rich_text blocks when the text is empty", () => {
    expect(
      renderSlackPostText({
        text: "",
        blocks: [
          {
            type: "rich_text",
            elements: [
              {
                type: "rich_text_section",
                elements: [
                  { type: "text", text: "ping " },
                  { type: "user", user_id: "U1" },
                ],
              },
              {
                type: "rich_text_list",
                elements: [
                  {
                    type: "rich_text_section",
                    elements: [{ type: "text", text: "one" }],
                  },
                  {
                    type: "rich_text_section",
                    elements: [{ type: "text", text: "two" }],
                  },
                ],
              },
            ],
          },
        ],
      }),
    ).toBe("ping <@U1>\n• one\n• two");
  });

  /**
   * TEST_SCENARIO: An Agent's post carries a `markdown` copy of its text and
   * an Agent Footer. Neither is content to repeat on the history line.
   */
  it("leaves an Agent's post as its text", () => {
    expect(
      renderSlackPostText({
        text: "*Alpha*\n\nDone.",
        blocks: [
          { type: "markdown", text: "**Alpha**\n\nDone." },
          {
            type: "context",
            elements: [
              { type: "mrkdwn", text: "<http://ui/a/agent-abc123|Alpha>" },
            ],
          },
        ],
      }),
    ).toBe("*Alpha*\n\nDone.");
  });

  /**
   * TEST_SCENARIO: Slack unfurls a link in a person's post into an
   * attachment. The preview repeats a link that is already in the text.
   */
  it("skips a link preview Slack unfurled", () => {
    expect(
      renderSlackPostText({
        text: "see <https://example.com>",
        attachments: [
          {
            from_url: "https://example.com",
            title: "Example Domain",
            text: "This domain is for use in examples.",
          },
        ],
      }),
    ).toBe("see <https://example.com>");
  });

  it("caps the flattened content but never the text", () => {
    const text = "x".repeat(3000);
    const rendered = renderSlackPostText({
      text,
      attachments: [{ text: "y".repeat(5000) }],
    });
    expect(rendered.startsWith(`${text}\n`)).toBe(true);
    expect(rendered.endsWith("… (truncated)")).toBe(true);
    expect(rendered.length).toBeLessThan(text.length + 2100);
  });

  it("keeps a post with no content empty", () => {
    expect(renderSlackPostText({})).toBe("");
  });
});
