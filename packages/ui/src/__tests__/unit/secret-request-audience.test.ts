// TEST_OVERVIEW: The owner who opens a secret-entry link reads, before they save, who else can ask the agent to use the connection with their access. When the agent that asked, or an agent a replaced secret is granted to, is a Shared Agent, the page names its Agent Editors and the channels it is bound to. An agent with no editors adds nothing to the page.
import type { SecretRequestView } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { SharedChannel } from "../../modules/sandboxes/lib/shared-channels.js";

const agents: Record<string, { name: string; editors: string[] }> = {
  shared: { name: "Release helper", editors: ["alice@example.com"] },
  solo: { name: "Notes", editors: [] },
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
  useSharedChannels: (id: string) => channels[id] ?? [],
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

const text = (v: SecretRequestView) =>
  renderToStaticMarkup(createElement(SecretRequestAudience, { view: v }))
    .replace(/<[^>]+>/g, "")
    .trim();

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

  // TEST_SCENARIO: AC-11 — a secret asked for by an agent with no editors adds nothing to the page.
  it("adds nothing for an agent with no editors", () => {
    expect(text(view({ requestedBy: { id: "solo", name: "Notes" } }))).toBe("");
  });
});
