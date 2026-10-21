// TEST_OVERVIEW: Settings / Providers offers CurveBender twice: the user-keyed integration reads "(custom key)" and keeps its Connect action, while the deployment's integration, named without the suffix, appears only where the install configures it and reads Connected as a static row once its connection exists, so an unconfigured install offers nothing it cannot serve.
import { CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProviderSection } from "../../modules/providers/components/provider-section.js";

type Item = { id: string; conn: { templateId: string } };

const state = vi.hoisted(() => ({
  flags: {} as Record<string, boolean> | undefined,
  templates: [] as { id: string }[] | undefined,
  itemsByTemplate: new Map<string, Item>(),
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
    itemByType: new Map(),
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

const CUSTOM = "IBM ETE LiteLLM CurveBender (custom key)";
const SHARED = "IBM ETE LiteLLM CurveBender";

const deploymentConfigured = () =>
  (state.templates = [{ id: CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID }]);

describe("CurveBender provider rows", () => {
  beforeEach(() => {
    state.flags = {};
    state.templates = [];
    state.itemsByTemplate = new Map();
  });

  // TEST_SCENARIO: the user-keyed integration keeps its Connect action under a name that says the key is the user's own.
  it("offers the custom-key integration to connect", () => {
    const html = render();
    expect(html).toContain(`title="${CUSTOM}"`);
    expect(html).toContain(`aria-label="Connect ${CUSTOM}"`);
  });

  // TEST_SCENARIO: an install that configures no deployment key shows no second CurveBender row.
  it("hides the deployment integration while unconfigured", () => {
    expect(render()).not.toContain(`title="${SHARED}"`);
  });

  // TEST_SCENARIO: a configured install shows the deployment integration under the original name, Connected and static once its connection exists, so no connect form or Disconnect reaches it.
  it("shows the deployment integration connected and static", () => {
    deploymentConfigured();
    state.itemsByTemplate = new Map([
      [
        CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
        { id: "c1", conn: { templateId: CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID } },
      ],
    ]);
    const html = render();
    expect(html).toContain(`title="${CUSTOM}"`);
    expect(html).toContain(`title="${SHARED}"`);
    expect(html).toContain("Connected");
    expect(html).not.toContain(`aria-label="Connect ${SHARED}"`);
    expect(html).not.toContain(`aria-label="Edit ${SHARED}"`);
    expect(html).not.toContain("Disconnect");
  });
});
