// TEST_OVERVIEW: An Agent Editor who answers an approval on a Shared Agent reads one line that says the action runs with the owner's connections, naming the owner and the agent's granted connections, each with the account it acts as when that is known. Model provider connections are left out, since a tool call never acts through them. More than three names end in "and N more", and no names means no line.
import { describe, expect, it } from "vitest";

import {
  actingConnectionNames,
  ownerConnectionsLine,
} from "../../modules/agents/lib/owner-connections.js";

const OWNER = "jordan@example.com";

describe("the owner's connections line", () => {
  // TEST_SCENARIO: an agent with a GitHub and a Slack connection names both, after the owner's email.
  it("names the owner and each connection", () => {
    expect(ownerConnectionsLine(OWNER, ["GitHub", "Slack"])).toEqual({
      text: "Runs with jordan@example.com's connections: GitHub, Slack.",
      names: ["GitHub", "Slack"],
      more: 0,
    });
  });

  // TEST_SCENARIO: three names still fit on the line.
  it("names three connections in full", () => {
    expect(ownerConnectionsLine(OWNER, ["GitHub", "Slack", "Jira"])?.text).toBe(
      "Runs with jordan@example.com's connections: GitHub, Slack, Jira.",
    );
  });

  // TEST_SCENARIO: five names show the first three and count the rest; the caller lists all five in a tooltip.
  it("cuts a long list short and counts the rest", () => {
    const names = ["GitHub", "Slack", "Jira", "Linear", "Notion"];
    expect(ownerConnectionsLine(OWNER, names)).toEqual({
      text: "Runs with jordan@example.com's connections: GitHub, Slack, Jira and 2 more.",
      names,
      more: 2,
    });
  });

  // TEST_SCENARIO: with no connection left to name, there is no line at all.
  it("shows no line without connections", () => {
    expect(ownerConnectionsLine(OWNER, [])).toBeNull();
  });
});

describe("which connections the line names", () => {
  // TEST_SCENARIO: a model provider connection is left out, and every other granted connection is named once.
  it("leaves out model providers", () => {
    expect(
      actingConnectionNames([
        { name: "GitHub", templateId: "github" },
        { name: "Anthropic", templateId: "anthropic" },
        { name: "Slack", templateId: "slack" },
        { name: "GitHub", templateId: "github" },
      ]),
    ).toEqual(["GitHub", "Slack"]);
  });
});

describe("the accounts the line names", () => {
  // TEST_SCENARIO: AC-8 — a GitHub connection acting as tomkis reads "GitHub as tomkis" on the editor's approval line; one with no known account reads by its name.
  it("names each connection as the account it acts as", () => {
    const names = actingConnectionNames([
      { name: "GitHub", templateId: "github", accountLabel: "tomkis" },
      { name: "Linear", templateId: "linear" },
    ]);
    expect(ownerConnectionsLine(OWNER, names)?.text).toBe(
      "Runs with jordan@example.com's connections: GitHub as tomkis, Linear.",
    );
  });
});
