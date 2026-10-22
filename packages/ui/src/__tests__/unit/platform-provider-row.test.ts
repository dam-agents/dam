// TEST_OVERVIEW: the built-in provider row in Settings / Providers shows only while the platform-provider feature is on, carries the brand name, reads Connected only once its platform-llm Connection exists, and offers nothing to open in Settings, so no connect form and no Disconnect action can reach it.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProviderSection } from "../../modules/providers/components/provider-section.js";

const state = vi.hoisted(() => ({
  flags: {} as Record<string, boolean> | undefined,
  templates: [] as { id: string }[] | undefined,
  items: new Map<string, { id: string; conn: { templateId: string } }>(),
  itemsByTemplate: new Map<
    string,
    { id: string; conn: { templateId: string } }
  >(),
}));

vi.mock("../../brand.js", () => ({ getBrand: () => ({ name: "Acme" }) }));
vi.mock("../../store.js", () => ({
  useStore: (select: (s: { showConfirm: () => void }) => unknown) =>
    select({ showConfirm: vi.fn() }),
}));
vi.mock("../../modules/features/api/queries.js", () => ({
  useFeatures: () => ({ data: state.flags, isPending: !state.flags }),
}));
vi.mock("../../modules/connections/api/mutations.js", () => ({
  useDeleteConnection: () => ({ mutate: vi.fn() }),
}));
vi.mock("../../modules/connections/api/queries.js", () => ({
  useConnectionTemplates: () => ({
    data: state.templates,
    isPending: state.templates === undefined,
  }),
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
vi.mock("../../modules/providers/hooks/use-provider-items.js", () => ({
  useProviderItems: () => ({
    itemByType: state.items,
    itemByTemplateId: state.itemsByTemplate,
    isPending: false,
  }),
}));

const render = (onConnected?: (id: string) => void) =>
  renderToStaticMarkup(
    createElement<NonNullable<Parameters<typeof ProviderSection>[0]>>(
      ProviderSection,
      {
        onConnected,
      },
    ),
  );

const platformRow = (html: string) =>
  html
    .split(/(?=<(?:button|div class="rounded-lg)[^>]*>)/)
    .find((part) => part.includes('title="Acme"'));

describe("built-in provider row", () => {
  beforeEach(() => {
    state.flags = {};
    state.templates = [];
    state.items = new Map();
    state.itemsByTemplate = new Map();
  });

  // TEST_SCENARIO: while the feature flags are still loading, only placeholders show, so the built-in row cannot appear later and shift the rows below it.
  it("shows no rows until the feature flags load", () => {
    state.flags = undefined;
    expect(render()).not.toContain("title=");
  });

  // TEST_SCENARIO: with the feature off, no row carries the brand name.
  it("is hidden while the feature is off", () => {
    expect(render()).not.toContain("Acme");
  });

  // TEST_SCENARIO: with the feature on and no connection listed yet, the row is titled with the brand, reads Not connected, and is not a button that opens a form or a Disconnect action.
  it("reads Not connected until its connection exists", () => {
    state.flags = { "platform-provider": true };
    const html = render();
    const row = platformRow(html);
    expect(row).toBeDefined();
    expect(row).toContain(">Acme</p>");
    expect(row).toContain("Not connected");
    expect(row?.startsWith("<button")).toBe(false);
    expect(html).not.toMatch(/(Edit|Connect) Acme/);
    expect(html).not.toContain("Disconnect");
  });

  // TEST_SCENARIO: once the platform-llm connection exists, the Settings row reads Connected and stays static.
  it("is a static, connected row once its connection exists", () => {
    state.flags = { "platform-provider": true };
    state.items = new Map([
      ["platform", { id: "c1", conn: { templateId: "platform-llm" } }],
    ]);
    const html = render();
    const row = platformRow(html);
    expect(row).toContain("Connected");
    expect(row).not.toContain("Not connected");
    expect(row?.startsWith("<button")).toBe(false);
    expect(html).not.toContain("Disconnect");
  });

  // TEST_SCENARIO: in the picker, with no connection yet, the built-in row is left out rather than shown with nothing to pick.
  it("is absent from the picker until its connection exists", () => {
    state.flags = { "platform-provider": true };
    expect(render(() => {})).not.toContain("Acme");
  });

  // TEST_SCENARIO: in the picker, the connected built-in row is a Use button, the only action it ever offers.
  it("offers Use in the picker once its connection exists", () => {
    state.flags = { "platform-provider": true };
    state.items = new Map([
      ["platform", { id: "c1", conn: { templateId: "platform-llm" } }],
    ]);
    const html = render(() => {});
    expect(html).toContain('aria-label="Use Acme"');
    expect(html).not.toContain("Disconnect");
  });
});
