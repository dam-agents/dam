// TEST_OVERVIEW: Settings / Providers offers CurveBender twice: the user-keyed integration reads "(own key)" and keeps its Connect action, while the deployment's integration, named "(shared)", appears only where the install configures it and reads Connected once its connection exists; its row opens a read-only explainer rather than a form, so an unconfigured install offers nothing it cannot serve.
import { CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CURVE_BENDER_DOCS_URL,
  CurveBenderInfoDialog,
} from "../../modules/providers/components/curve-bender-info-dialog.js";
import { ProviderSection } from "../../modules/providers/components/provider-section.js";

type Item = { id: string; conn: { templateId: string } };

const state = vi.hoisted(() => ({
  flags: {} as Record<string, boolean> | undefined,
  templates: [] as { id: string }[] | undefined,
  itemsByTemplate: new Map<string, Item>(),
}));

vi.mock("../../brand.js", () => ({ getBrand: () => ({ name: "Acme" }) }));
const passthrough = vi.hoisted(
  () =>
    ({ children }: { children?: unknown }) =>
      children,
);
vi.mock("@/components/modal", () => ({
  Modal: passthrough,
  DialogHeader: passthrough,
  DialogBody: passthrough,
  DialogFooter: passthrough,
}));
vi.mock("../../modules/spend/components/all-agents-provider-limit.js", () => ({
  AllAgentsSpendBadge: () => null,
}));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: unknown }) => children,
}));
vi.mock("../../store.js", () => ({
  useStore: (select: (s: { showConfirm: () => void }) => unknown) =>
    select({ showConfirm: vi.fn() }),
}));
vi.mock("../../modules/features/api/queries.js", () => ({
  useFeatures: () => ({ data: state.flags, isPending: !state.flags }),
}));
vi.mock("../../modules/connections/hooks/use-disconnect-connection.js", () => ({
  useDisconnectConnection: () => ({
    confirmAndDelete: vi.fn(),
    deletingId: null,
  }),
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

const CUSTOM = "CurveBender (own key)";
const SHARED = "CurveBender (shared)";

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
    expect(html).toContain(`>${CUSTOM}<`);
    expect(html).toContain(`aria-label="Connect ${CUSTOM}"`);
  });

  // TEST_SCENARIO: an install that configures no deployment key shows no second CurveBender row.
  it("hides the deployment integration while unconfigured", () => {
    expect(render()).not.toContain(`>${SHARED}<`);
  });

  // TEST_SCENARIO: a configured install shows the deployment integration under the original name and Connected once its connection exists; its row is a button that opens the explainer, since the user holds no key to edit, and no connect form or Disconnect reaches it.
  it("opens the explainer from the connected deployment row", () => {
    deploymentConfigured();
    state.itemsByTemplate = new Map([
      [
        CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
        { id: "c1", conn: { templateId: CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID } },
      ],
    ]);
    const html = render();
    expect(html).toContain(`>${CUSTOM}<`);
    expect(html).toContain(`>${SHARED}<`);
    expect(html).toContain("Configured · Connected");
    expect(html).toMatch(
      /<button[^>]*aria-label="About CurveBender \(shared\)"/,
    );
    expect(html).not.toContain(`aria-label="Connect ${SHARED}"`);
    expect(html).not.toContain(`aria-label="Edit ${SHARED}"`);
    expect(html).not.toContain("Disconnect");
  });

  // TEST_SCENARIO: the explainer is read-only: it says what CurveBender is and that inference is free within fair use, and its only control is Close, with the docs link opening in a new tab.
  it("explains the deployment integration without a form", () => {
    const html = renderToStaticMarkup(
      createElement(CurveBenderInfoDialog, { onClose: () => {} }),
    );
    expect(html).toContain("CurveBender</a> is an IBM Research platform");
    expect(html).toContain(
      "All Acme users are provided with free inference on CurveBender, subject to fair-use policy.",
    );
    expect(html).toContain(`href="${CURVE_BENDER_DOCS_URL}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toMatch(/<button[^>]*>Close<\/button>/);
    expect(html).not.toContain("<input");
  });
});
