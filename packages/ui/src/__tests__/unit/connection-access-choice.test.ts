// @vitest-environment happy-dom
// TEST_OVERVIEW: The web app's side of a connection that is read only unless it has full access, which a Slack Account is. The create form sends full access only when the owner picks it. Every row of such a connection says which mode it is in, in the line under its name; one that can post as the owner also carries the danger mark under the template's own label. The warning before an agent is shared with a chat says what the people there can do through each such connection.
import type { ConnectionTemplateView, ConnectionView } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BindSharingText } from "../../modules/agents/components/bind/bind-sharing-text.js";
import { StatusBadges } from "../../modules/connections/components/catalog-connection-row.js";
import { buildCreatePayload } from "../../modules/connections/lib/build-create-payload.js";
import { connectionDetail } from "../../modules/connections/lib/connection-detail.js";

const accessChoice = { fullAccessLabel: "Can post as me" };

const SLACK_TEMPLATE: ConnectionTemplateView = {
  id: "slack",
  name: "Slack Account",
  category: "app",
  isCustom: false,
  authKind: "oauth",
  inputs: [],
  accessChoice,
};

const LINEAR_TEMPLATE: ConnectionTemplateView = {
  ...SLACK_TEMPLATE,
  id: "linear",
  name: "Linear",
  accessChoice: undefined,
};

const connection = (over: Partial<ConnectionView>): ConnectionView =>
  ({
    id: "conn-slack",
    name: "my-slack",
    templateId: "slack",
    authKind: "oauth",
    status: "active",
    accountLabel: "ada@acme.example",
    accessChoice,
    ...over,
  }) as ConnectionView;

const badges = (c: ConnectionView) =>
  renderToStaticMarkup(createElement(StatusBadges, { connection: c }));

describe("connecting a Slack Account", () => {
  const create = (
    template: ConnectionTemplateView,
    access: "narrowed" | "full",
  ) =>
    buildCreatePayload(template, {
      name: "my-slack",
      fields: {},
      overrideDefaults: false,
      access,
    });

  // TEST_SCENARIO: read only is the form's default, so a create the owner did not change must not ask for full access: the server makes the connection read only when the flag is absent.
  it("sends no full access unless the owner picks it", () => {
    expect(create(SLACK_TEMPLATE, "narrowed")).not.toHaveProperty("fullAccess");
    expect(create(SLACK_TEMPLATE, "full")).toMatchObject({ fullAccess: true });
  });

  // TEST_SCENARIO: the form's access field belongs to templates that offer the choice. A template without it never sends the flag, which the server would refuse.
  it("sends no full access for a template without the choice", () => {
    expect(create(LINEAR_TEMPLATE, "full")).not.toHaveProperty("fullAccess");
  });
});

describe("a Slack Account connection's row", () => {
  // TEST_SCENARIO: the owner opens an agent's Connections and must see that the agent can only read Slack. Read only is the default, so it adds no mark beside the name, as a narrowed GitHub connection adds none; the line under the name says it.
  it("says a read-only connection is read only in its line", () => {
    expect(badges(connection({}))).toBe("");
    expect(connectionDetail(connection({}))).toEqual({
      account: "Acts as ada@acme.example",
      reach: { text: "Read only: searches and reads as you, posts nothing" },
    });
  });

  // TEST_SCENARIO: a connection that can post as the owner carries the danger mark under the template's own label, not GitHub's "Full access", and its line says the agent acts as the owner.
  it("marks a connection that can post under the template's label", () => {
    const posting = connection({ fullAccess: true });
    const html = badges(posting);
    expect(html).toContain('data-testid="connection-full-access-conn-slack"');
    expect(html).toContain("Can post as me");
    expect(html).not.toContain("Full access");
    expect(connectionDetail(posting).reach?.text).toBe(
      "Searches, reads and posts as you",
    );
  });

  // TEST_SCENARIO: the choice belongs to templates that offer it. A GitHub connection keeps its own "Full access" mark, and a connection without the choice gets no mark and no access line.
  it("leaves other connections as they were", () => {
    const github = connection({
      id: "conn-gh",
      templateId: "github",
      accessChoice: undefined,
      fullAccess: true,
    });
    expect(badges(github)).toContain("Full access");
    expect(
      badges(connection({ accessChoice: undefined, templateId: "linear" })),
    ).toBe("");
  });
});

describe("sharing an agent that holds a Slack Account with a chat", () => {
  const text = (
    accessChoices: { name: string; access: "read-only" | "full" }[],
  ) =>
    renderToStaticMarkup(
      createElement(BindSharingText, {
        agentName: "helper",
        connectionNames: accessChoices.map((c) => c.name),
        accessChoices,
        audience: {
          kind: "slack-channel",
          id: "C1",
          name: "team",
        } as never,
        whisper: false,
      }),
    ).replace(/<[^>]+>/g, "");

  // TEST_SCENARIO: a read-only Slack Account still lets the people in the chat read the owner's Slack through the agent, so the warning stays and says exactly that, and that nothing can be changed.
  it("says a read-only connection lets them read and change nothing", () => {
    const shown = text([{ name: "my-slack", access: "read-only" }]);
    expect(shown).toContain("ask it to use it, with your access.");
    expect(shown).toContain(
      "my-slack is read only: through it they can read what you can read, and change nothing.",
    );
    expect(shown).not.toContain("post");
  });

  // TEST_SCENARIO: with full access the people in the chat can make the agent post as the owner, so the warning adds posting.
  it("says a connection with full access also lets them post as the owner", () => {
    expect(text([{ name: "my-slack", access: "full" }])).toContain(
      "Through my-slack they can also post and change things as you.",
    );
  });
});
