// @vitest-environment happy-dom
// TEST_OVERVIEW: One provider's Connections in the composer's + menu, as the chat refresh design's ConnectionGroupCard draws them: a card titled with the provider and its count, then a row per Connection with its name, its status, and what kind it is under it, with no host chip; the row's menu, behind the design's horizontal ⋯, shows only for a viewer who may change the Agent's Connections.
import type { ConnectionView } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../modules/connections/components/connection-icon.js", () => ({
  ConnectionIcon: () => createElement("span", { "data-testid": "icon" }),
}));
vi.mock(
  "../../modules/connections/components/connection-row-actions.js",
  () => ({
    ConnectionRowMenu: (props: {
      connection: { id: string };
      horizontal?: boolean;
    }) =>
      createElement("button", {
        "data-testid": `menu-${props.connection.id}`,
        "data-horizontal": String(!!props.horizontal),
      }),
  }),
);
vi.mock("../../modules/connections/lib/catalog-providers.js", () => ({
  connectionKindSubtitle: (c: { id: string }) =>
    c.id === "c-pat" ? "Personal access token" : "GitHub OAuth",
}));
vi.mock(
  "../../modules/connections/components/catalog-connection-row.js",
  () => ({
    StatusBadges: (props: { connection: { status: string } }) =>
      props.connection.status === "active"
        ? null
        : createElement("span", null, "Authorizing…"),
  }),
);

const { QuickConnectionGroup } =
  await import("../../modules/sessions/components/plus-menu/quick-connection-group.js");

const connection = (id: string, name: string, status = "active") =>
  ({ id, name, status, templateId: "github" }) as unknown as ConnectionView;

const group = {
  provider: { id: "github", title: "GitHub", iconSlug: "github" },
  connections: [
    connection("c-oauth", "acme-org GitHub"),
    connection("c-pat", "ci-bot PAT", "pending"),
  ],
} as never;

const render = (manages: boolean) =>
  renderToStaticMarkup(
    createElement(QuickConnectionGroup, {
      group,
      templateById: new Map(),
      grant: manages
        ? () => ({ granted: true, onToggle: () => {}, actionHidden: true })
        : undefined,
      maintenance: manages ? () => ({}) : undefined,
    }),
  );

describe("a provider's card in the + menu", () => {
  // TEST_SCENARIO: the card is titled with the provider and how many Connections it holds, and each row names the Connection, its status and its kind.
  it("draws the design's card", () => {
    const html = render(true);
    expect(html).toContain("GitHub");
    expect(html).toContain("2 connections");
    expect(html).toContain("acme-org GitHub");
    expect(html).toContain("GitHub OAuth");
    expect(html).toContain("Personal access token");
    expect(html).toContain("Authorizing…");
    expect(html).toContain('data-testid="menu-c-oauth"');
    expect(html).toContain('data-horizontal="true"');
  });

  // TEST_SCENARIO: a viewer who may not change the Agent's Connections sees the same rows with no menu.
  it("leaves out the menu for a viewer", () => {
    const html = render(false);
    expect(html).toContain("acme-org GitHub");
    expect(html).not.toContain('data-testid="menu-');
  });
});
