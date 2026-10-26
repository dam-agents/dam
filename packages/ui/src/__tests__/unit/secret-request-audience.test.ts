// @vitest-environment happy-dom
// TEST_OVERVIEW: The owner who opens a secret-entry link reads, before they save, who else can ask the agent to use the connection with their access. When the agent that asked, or an agent a replaced secret is granted to, is a Shared Agent, the page names its Agent Editors and the channels it is bound to. An agent with no editors adds nothing to the page. A GitHub App installation is never held by an agent itself, so a save that stores only the installation names no agent, and a replaced key names the agents of the connections made from it.
import type { SecretRequestView } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { SharedChannel } from "../../modules/sandboxes/lib/shared-channels.js";

const agents: Record<string, { name: string; editors: string[] }> = {
  shared: { name: "Release helper", editors: ["alice@example.com"] },
  solo: { name: "Notes", editors: [] },
  loading: { name: "Triage", editors: ["alice@example.com"] },
};
const channels: Record<string, SharedChannel[]> = {
  shared: [{ kind: "slack-channel", name: "#team-x" }],
};

vi.mock("../../modules/agents/api/queries.js", () => ({
  useAgent: (id: string) => {
    const agent = agents[id];
    return agent
      ? {
          id,
          name: agent.name,
          access: { role: "owner", editors: agent.editors, permissions: [] },
        }
      : null;
  },
}));
vi.mock("../../modules/sandboxes/hooks/use-shared-channels.js", () => ({
  useSharedChannels: (id: string) =>
    id === "loading" ? null : (channels[id] ?? []),
}));

const { SecretRequestAudience } =
  await import("../../modules/connections/components/secret-request-audience.js");

const view = (patch: Partial<SecretRequestView>): SecretRequestView => ({
  action: "create",
  connectionName: "github",
  templateId: "github-pat",
  templateName: "GitHub",
  authKind: "header",
  destinations: [],
  unexpectedHosts: [],
  customDestination: false,
  envNames: [],
  grantedAgents: [],
  fields: [],
  expiresAt: "2026-10-25T12:00:00Z",
  ...patch,
});

const textOf = (html: string) =>
  new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";

const text = (v: SecretRequestView) =>
  textOf(
    renderToStaticMarkup(createElement(SecretRequestAudience, { view: v })),
  ).trim();

describe("the secret page of a Shared Agent", () => {
  // TEST_SCENARIO: AC-9 — an editor asked a Shared Agent bound to #team-x for a new secret; the owner's page names the editor and the channel.
  it("names the editors and channels of the agent that asked", () => {
    expect(
      text(view({ requestedBy: { id: "shared", name: "Release helper" } })),
    ).toBe(
      "Editor alice@example.com, and anyone in the Slack channel #team-x, can ask Release helper to use this connection, with your access.",
    );
  });

  // TEST_SCENARIO: AC-10 — replacing the secret of a connection granted to a Shared Agent shows the same notice, once for that agent.
  it("names the editors of each agent a replaced secret is granted to", () => {
    const html = text(
      view({
        action: "update",
        grantedAgents: [
          { id: "shared", name: "Release helper" },
          { id: "solo", name: "Notes" },
        ],
        requestedBy: { id: "shared", name: "Release helper" },
      }),
    );
    expect(html.match(/alice@example\.com/g)).toHaveLength(1);
    expect(html).not.toContain("Notes");
  });

  // TEST_SCENARIO: while the agent's channels are not known yet, the page names the editors and says anyone in a bound channel can too.
  it("names the channel case while the channels are unknown", () => {
    expect(text(view({ requestedBy: { id: "loading", name: "Triage" } }))).toBe(
      "Editor alice@example.com can ask Triage to use this connection, with your access. If it is bound to a Slack channel or a group chat, anyone there can too.",
    );
  });

  // TEST_SCENARIO: AC-11 — a secret asked for by an agent with no editors adds nothing to the page.
  it("adds nothing for an agent with no editors", () => {
    expect(text(view({ requestedBy: { id: "solo", name: "Notes" } }))).toBe("");
  });
});

describe("the secret page of a GitHub App installation", () => {
  // TEST_SCENARIO: a Shared Agent asked for an installation with no reach; the save stores the installation alone and the agent gets nothing, so no notice may say it can use it.
  it("names no agent when the save stores the installation only", () => {
    expect(
      text(
        view({
          authKind: "github-app",
          templateId: "github-app",
          requestedBy: { id: "shared", name: "Release helper" },
        }),
      ),
    ).toBe("");
  });

  // TEST_SCENARIO: replacing an installation's key reaches the agents that hold connections made from it, so the notice says they use those connections.
  it("says the agents use the connections made from it when its key is replaced", () => {
    expect(
      text(
        view({
          action: "update",
          authKind: "github-app",
          templateId: "github-app",
          isParent: true,
          grantedAgents: [{ id: "shared", name: "Release helper" }],
        }),
      ),
    ).toBe(
      "Editor alice@example.com, and anyone in the Slack channel #team-x, can ask Release helper to use the connections made from this GitHub App installation, with your access.",
    );
  });
});
