// TEST_OVERVIEW: Settings / Providers carries one Recheck button for the whole section, shown once a provider whose template has a key check is connected. While the recheck runs, the button and every row it checks say so, and each badge keeps its last known state. After it, each row shows the stored result of its last key check: a check mark with the time when the key worked, a refused state in place of the green Connected badge that asks for a new key and is named in the row's accessible name, a neutral warning with the detail when the provider could not say, and "not checked" for a Connection that carries no result.
import type { ProviderKeyCheck } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProviderSection } from "../../modules/providers/components/provider-section.js";

const state = vi.hoisted(() => ({
  pending: false,
  flags: {} as Record<string, boolean>,
  items: new Map<
    string,
    {
      id: string;
      conn: { templateId: string; keyCheck?: ProviderKeyCheck };
    }
  >(),
  itemsByTemplate: new Map<
    string,
    {
      id: string;
      conn: { templateId: string; keyCheck?: ProviderKeyCheck };
    }
  >(),
}));

vi.mock("../../brand.js", () => ({ getBrand: () => ({ name: "Acme" }) }));
vi.mock("../../modules/spend/components/all-agents-provider-limit.js", () => ({
  AllAgentsProviderLimit: () => null,
}));
vi.mock("../../store.js", () => ({
  useStore: (select: (s: { showConfirm: () => void }) => unknown) =>
    select({ showConfirm: vi.fn() }),
}));
vi.mock("../../modules/features/api/queries.js", () => ({
  useFeatures: () => ({ data: state.flags, isPending: false }),
}));
vi.mock("../../modules/connections/api/mutations.js", () => ({
  useDeleteConnection: () => ({ mutate: vi.fn() }),
}));
vi.mock("../../modules/connections/api/queries.js", () => ({
  useConnectionTemplates: () => ({
    data: [{ id: "curve-bender-deployment" }],
    isPending: false,
  }),
}));
vi.mock("../../modules/providers/api/mutations.js", () => ({
  useRecheckProviderKeys: () => ({
    mutate: vi.fn(),
    isPending: state.pending,
  }),
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
vi.mock("../../modules/providers/hooks/use-provider-items.js", () => ({
  useProviderItems: () => ({
    itemByType: state.items,
    itemByTemplateId: state.itemsByTemplate,
    isPending: false,
  }),
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

const CHECKED_AT = "2026-10-20T09:15:00.000Z";

describe("provider key recheck", () => {
  beforeEach(() => {
    state.pending = false;
    state.flags = {};
    state.items = new Map();
    state.itemsByTemplate = new Map();
  });

  // TEST_SCENARIO: with no provider connected there is no key to check, so no Recheck button shows.
  it("offers no recheck without a connected provider", () => {
    expect(render()).not.toContain("Recheck");
  });

  // TEST_SCENARIO: one Recheck button serves the whole section, however many providers are connected.
  it("shows one Recheck button for the section", () => {
    state.items = new Map([
      ["anthropic", { id: "c1", conn: { templateId: "anthropic" } }],
      ["openai", { id: "c2", conn: { templateId: "openai" } }],
    ]);
    expect(render().match(/Recheck keys/g)).toHaveLength(1);
  });

  // TEST_SCENARIO: a key that worked at its last check reads Connected with a check mark and the time it was checked.
  it("shows when a working key was last checked", () => {
    state.items = new Map([
      [
        "anthropic",
        {
          id: "c1",
          conn: {
            templateId: "anthropic",
            keyCheck: { result: "ok", checkedAt: CHECKED_AT },
          },
        },
      ],
    ]);
    const row = rowOf(render(), "Edit Anthropic");
    expect(row).toContain("Connected");
    expect(row).toContain("Last checked");
    expect(row).not.toContain("refused");
  });

  // TEST_SCENARIO: a key the provider refused replaces the green Connected badge with Key refused and asks the user to replace the key, with the HTTP detail.
  it("marks a refused key and asks for a new one", () => {
    state.items = new Map([
      [
        "anthropic",
        {
          id: "c1",
          conn: {
            templateId: "anthropic-oauth",
            keyCheck: {
              result: "refused",
              detail: "HTTP 401",
              checkedAt: CHECKED_AT,
            },
          },
        },
      ],
    ]);
    const row = rowOf(render(), "Edit Anthropic");
    expect(row).toContain('aria-label="Edit Anthropic, key refused"');
    expect(row).toContain("Key refused");
    expect(row).not.toContain(">Connected<");
    expect(row).toContain("HTTP 401");
    expect(row).toContain("Replace the key");
    expect(row).not.toContain("Last checked");
  });

  // TEST_SCENARIO: a check that said nothing about the key keeps the row Connected and shows a neutral warning with the detail.
  it("warns when the key could not be verified", () => {
    state.items = new Map([
      [
        "openai",
        {
          id: "c2",
          conn: {
            templateId: "openai",
            keyCheck: {
              result: "unverified",
              detail: "HTTP 503",
              checkedAt: CHECKED_AT,
            },
          },
        },
      ],
    ]);
    const row = rowOf(render(), "Edit OpenAI");
    expect(row).toContain(">Connected<");
    expect(row).toContain("Could not verify the key");
    expect(row).toContain("HTTP 503");
  });

  // TEST_SCENARIO: a Connection stored before its key was ever checked carries no result, so its row says the key is not checked.
  it("says a key with no check is not checked", () => {
    state.items = new Map([["bob", { id: "c3", conn: { templateId: "bob" } }]]);
    const row = rowOf(render(), "Edit Bob");
    expect(row).toContain("Key not checked");
  });

  // TEST_SCENARIO: the deployment CurveBender's key is not the user's to check, so an install holding only it gets no Recheck button, since a recheck could never change its row.
  it("offers no recheck when no connected provider has a key check", () => {
    state.itemsByTemplate = new Map([
      [
        "curve-bender-deployment",
        { id: "c3", conn: { templateId: "curve-bender-deployment" } },
      ],
    ]);
    expect(render()).not.toContain("Recheck");
  });

  // TEST_SCENARIO: while the recheck runs, the button is disabled and reads Rechecking, and each checkable row shows progress in place of its last result line; the badge keeps the last known state, so a refused key never flips to Connected.
  it("shows progress while the recheck runs", () => {
    state.pending = true;
    state.items = new Map([
      [
        "anthropic",
        {
          id: "c1",
          conn: {
            templateId: "anthropic-oauth",
            keyCheck: {
              result: "refused",
              detail: "HTTP 401",
              checkedAt: CHECKED_AT,
            },
          },
        },
      ],
    ]);
    const html = render();
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Rechecking…/);
    const row = rowOf(html, "Edit Anthropic");
    expect(row).toContain("Checking the key…");
    expect(row).toContain(">Key refused<");
    expect(row).not.toContain(">Connected<");
  });
});
