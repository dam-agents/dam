// TEST_OVERVIEW: Settings / Providers shows every provider connection the owner holds: several connections of one provider, such as two Anthropic keys made with the CLI, each get a row of their own, named after the connection, with their own status and spend, while a provider held once keeps its plain name.
import type { ConnectionView } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProviderSection } from "../../modules/providers/components/provider-section.js";

const state = vi.hoisted(() => ({
  connections: [] as Partial<ConnectionView>[],
}));

vi.mock("../../brand.js", () => ({ getBrand: () => ({ name: "Acme" }) }));
vi.mock("../../modules/spend/components/all-agents-provider-limit.js", () => ({
  AllAgentsSpendBadge: ({ connectionId }: { connectionId: string }) =>
    `spend:${connectionId}`,
}));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: unknown }) => children,
}));
vi.mock("../../store.js", () => ({
  useStore: (select: (s: { showConfirm: () => void }) => unknown) =>
    select({ showConfirm: vi.fn() }),
}));
vi.mock("../../modules/connections/hooks/use-disconnect-connection.js", () => ({
  useDisconnectConnection: () => ({
    confirmAndDelete: vi.fn(),
    deletingId: null,
  }),
}));
vi.mock("../../modules/connections/api/queries.js", () => ({
  useAppConnections: () => ({
    data: state.connections,
    isPending: false,
    isSuccess: true,
  }),
  useConnectionTemplates: () => ({ data: [], isPending: false }),
}));
vi.mock("../../modules/providers/api/mutations.js", () => ({
  useRecheckProviderKeys: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../../modules/sessions/api/session-pair.js", () => ({
  useHarnessCatalog: () => ({ data: { harnesses: [] }, isPending: false }),
}));
vi.mock("../../modules/providers/components/provider-balance.js", () => ({
  ProviderBalance: () => null,
}));
vi.mock(
  "../../modules/providers/components/provider-connect-dialog.js",
  () => ({
    ProviderConnectDialog: () => null,
  }),
);
vi.mock("../../modules/provider-status/api/queries.js", () => ({
  useProviderStatus: () => ({ data: undefined }),
}));

const render = () =>
  renderToStaticMarkup(
    createElement<NonNullable<Parameters<typeof ProviderSection>[0]>>(
      ProviderSection,
      {},
    ),
  );

const rowOf = (html: string, label: string) =>
  html
    .split(/(?=<button)/)
    .find((part) => part.includes(`aria-label="${label}`));

const connection = (
  id: string,
  templateId: string,
  name: string,
  extra: Partial<ConnectionView> = {},
): Partial<ConnectionView> => ({ id, templateId, name, ...extra });

describe("several connections of one provider", () => {
  beforeEach(() => {
    state.connections = [];
  });

  // TEST_SCENARIO: two Anthropic connections, an API key and an OAuth token, each get their own row named after the connection, each Configured with its own spend, and no row offers to connect Anthropic again.
  it("shows a row for each Anthropic connection", () => {
    state.connections = [
      connection("c1", "anthropic", "work-anthropic"),
      connection("c2", "anthropic-oauth", "personal-claude"),
    ];
    const html = render();
    const work = rowOf(html, "Edit Anthropic (work-anthropic)");
    const personal = rowOf(html, "Edit Anthropic (personal-claude)");
    expect(work).toContain(">Anthropic (work-anthropic)<");
    expect(work).toContain("Configured · Connected");
    expect(work).toContain("spend:c1");
    expect(personal).toContain(">Anthropic (personal-claude)<");
    expect(personal).toContain("spend:c2");
    expect(html).not.toContain('aria-label="Connect Anthropic"');
  });

  // TEST_SCENARIO: each row carries its own key's state, so a rejected key marks only its own connection.
  it("keeps each connection's key state on its own row", () => {
    state.connections = [
      connection("c1", "anthropic", "work-anthropic", {
        keyCheck: {
          result: "refused",
          detail: "HTTP 401",
          checkedAt: "2026-10-20T09:15:00.000Z",
        },
      }),
      connection("c2", "anthropic", "spare-anthropic", {
        keyCheck: { result: "ok", checkedAt: "2026-10-20T09:15:00.000Z" },
      }),
    ];
    const html = render();
    expect(rowOf(html, "Edit Anthropic (work-anthropic)")).toContain(
      "Configured · Key rejected",
    );
    expect(rowOf(html, "Edit Anthropic (spare-anthropic)")).toContain(
      "Configured · Connected",
    );
  });

  // TEST_SCENARIO: a connection whose account is known is named by it too, as elsewhere in the app.
  it("names the account of a connection", () => {
    state.connections = [
      connection("c1", "anthropic", "anthropic", { accountLabel: "Team A" }),
      connection("c2", "anthropic", "anthropic-2"),
    ];
    expect(render()).toContain(">Anthropic (anthropic as Team A)<");
  });

  // TEST_SCENARIO: a provider held once keeps its plain name, and providers not held still offer to connect.
  it("keeps the plain name for a single connection", () => {
    state.connections = [connection("c1", "anthropic", "work-anthropic")];
    const html = render();
    expect(html).toContain(">Anthropic<");
    expect(html).toContain('aria-label="Edit Anthropic"');
    expect(html).toContain('aria-label="Connect OpenAI"');
  });
});
