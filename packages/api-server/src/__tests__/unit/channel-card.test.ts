import { describe, expect, it } from "vitest";
import {
  buildChannelCard,
  cardComponents,
} from "../../modules/channels/infrastructure/channel-card.js";

/**
 * TEST_OVERVIEW: A Channel Card is the structured part of an Agent post in
 * Slack or Telegram. The agent writes it as a tree of json-render's chat
 * components; the platform flattens and checks it with json-render's toCard
 * against Slack's per-message limits, refuses any element that needs a click
 * to reach the agent, and keeps a Markdown text form for notifications and
 * later turns. The component list the agent reads is generated from the same
 * catalog, so these specs also pin what that list shows.
 */

const deploys = {
  type: "Card",
  props: { title: "Deploys" },
  children: [
    {
      type: "Fields",
      props: {},
      children: [
        { type: "Field", props: { label: "Status", value: "green" } },
        { type: "Field", props: { label: "Owner", value: "platform" } },
      ],
    },
    {
      type: "Actions",
      props: {},
      children: [
        {
          type: "LinkButton",
          props: { label: "Open", url: "https://example.com" },
        },
      ],
    },
  ],
};

const table = {
  type: "Table",
  props: { headers: ["Week", "Deploys"], rows: [["W44", 12]] },
};

describe("buildChannelCard", () => {
  it("turns a nested tree into a card with a Markdown text form", () => {
    const built = buildChannelCard(deploys);
    if (!("card" in built)) throw new Error(built.issues.join("; "));
    expect(built.card.card.title).toBe("Deploys");
    expect(built.card.card.children.map((c) => c.type)).toEqual([
      "fields",
      "actions",
    ]);
    expect(built.card.text).toContain("**Deploys**");
    expect(built.card.text).toContain("Status");
    expect(built.card.text).toContain("green");
  });

  it("returns json-render's issues for a prop that fails its schema", () => {
    const built = buildChannelCard({
      type: "Card",
      props: {},
      children: [{ type: "Text", props: { content: "" } }],
    });
    expect("issues" in built && built.issues.length).toBeGreaterThan(0);
  });

  // TEST_SCENARIO: Slack's adapter turns a second table into a code block, so the limit refuses the card instead and the agent splits it.
  it("refuses a second table in one card", () => {
    const built = buildChannelCard({
      type: "Card",
      props: { title: "Two tables" },
      children: [table, table],
    });
    expect("issues" in built && built.issues.join(" ")).toMatch(/Table/);
  });

  // TEST_SCENARIO: Slack cuts a header at 150 characters and a field at 2000 without refusing the post, so the reader would lose text no one is told about.
  it("refuses a title or a field Slack would cut", () => {
    const built = buildChannelCard({
      type: "Card",
      props: { title: "t".repeat(151) },
      children: [
        {
          type: "Fields",
          props: {},
          children: [
            { type: "Field", props: { label: "Log", value: "v".repeat(2001) } },
          ],
        },
      ],
    });
    const issues = "issues" in built ? built.issues.join(" ") : "";
    expect(issues).toMatch(/title holds 151 characters/);
    expect(issues).toMatch(/Field "Log"/);
  });

  // TEST_SCENARIO: Slack's adapter turns a table with more than 10000 characters in its cells into a cut ASCII block, so the card is refused instead.
  it("refuses a table with more characters than Slack shows as a table", () => {
    const built = buildChannelCard({
      type: "Card",
      props: { title: "Log" },
      children: [
        {
          type: "Table",
          props: {
            headers: ["Line"],
            rows: Array.from({ length: 50 }, () => ["x".repeat(250)]),
          },
        },
      ],
    });
    expect("issues" in built && built.issues.join(" ")).toMatch(
      /characters in its cells/,
    );
  });

  // TEST_SCENARIO: A channel has no way yet for a click to reach the agent, so a button that sends a choice back would do nothing.
  it("refuses a button that sends a choice back", () => {
    const built = buildChannelCard({
      type: "Card",
      props: { title: "Approve?" },
      children: [
        {
          type: "Actions",
          props: {},
          children: [
            { type: "Button", props: { id: "approve", label: "Approve" } },
          ],
        },
      ],
    });
    expect("issues" in built && built.issues.join(" ")).toMatch(/LinkButton/);
  });
});

describe("cardComponents", () => {
  const byName = new Map(cardComponents().map((c) => [c.name, c]));

  it("lists the components a channel card can show, each with where it goes", () => {
    expect(byName.get("Card")?.children).toBe(true);
    expect(byName.get("Field")?.inside).toBe("Fields");
    expect(byName.get("LinkButton")?.inside).toBe("Actions");
    expect(byName.get("Table")?.inside).toBeUndefined();
  });

  it("leaves out a component whose example renders an interactive element", () => {
    expect(byName.has("Button")).toBe(false);
  });

  it("gives each component's props as JSON Schema", () => {
    expect(byName.get("Image")?.props).toMatchObject({
      type: "object",
      properties: { url: { type: "string" }, alt: { type: "string" } },
    });
  });
});
