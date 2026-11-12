// TEST_OVERVIEW: Settings › Providers shows the deployment's shared CurveBender as its own read-only row named "CurveBender", which opens an explainer instead of a key form. The own-key CurveBender row is hidden while the person holds no own key, and shown beside the shared row once they do; without the shared Connection the page is as before.
import { CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { sandboxSubtitleParts } from "../../modules/agents/utils/sandbox-subtitle.js";
import {
  CURVE_BENDER_DOCS_URL,
  CurveBenderInfoDialog,
} from "../../modules/providers/components/curve-bender-info-dialog.js";
import { CURVE_BENDER_RESTRICTIONS_URL } from "../../modules/providers/components/curve-bender-restriction.js";
import { ProviderSection } from "../../modules/providers/components/provider-section.js";

const state = vi.hoisted(() => ({
  connections: [] as { id: string; templateId: string }[],
}));
const passthrough = vi.hoisted(
  () =>
    ({ children }: { children?: unknown }) =>
      children,
);

vi.mock("../../brand.js", () => ({ getBrand: () => ({ name: "Acme" }) }));
vi.mock("@/components/modal", () => ({
  Modal: passthrough,
  DialogHeader: passthrough,
  DialogBody: passthrough,
  DialogFooter: passthrough,
}));
vi.mock("@/components/ui/tooltip", () => ({ Tooltip: passthrough }));
vi.mock("../../store.js", () => ({
  useStore: (select: (s: { showConfirm: () => void }) => unknown) =>
    select({ showConfirm: vi.fn() }),
}));
vi.mock("../../modules/connections/api/mutations.js", () => ({
  useDeleteConnection: () => ({ mutate: vi.fn() }),
}));
vi.mock("../../modules/connections/api/queries.js", () => ({
  useAppConnections: () => ({
    data: state.connections,
    isPending: false,
    isSuccess: true,
  }),
}));
vi.mock(
  "../../modules/providers/components/provider-connect-dialog.js",
  () => ({ ProviderConnectDialog: () => null }),
);

const shared = {
  id: "conn-shared",
  templateId: CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
};
const ownKey = { id: "conn-own", templateId: "curve-bender" };

function render(connections: { id: string; templateId: string }[]) {
  state.connections = connections;
  return renderToStaticMarkup(createElement(ProviderSection));
}

const count = (html: string, text: string) => html.split(text).length - 1;

describe("CurveBender on Settings › Providers", () => {
  // TEST_SCENARIO: a person who holds only the shared Connection sees one CurveBender row, named "CurveBender" and connected, with no own-key row whose Edit or Remove key the server would refuse.
  it("shows the shared Connection alone", () => {
    const html = render([shared]);
    expect(html).toContain(">CurveBender<");
    expect(html).not.toContain("CurveBender custom key");
    expect(html).not.toContain("Actions for CurveBender");
  });

  // TEST_SCENARIO: a person who also holds an own CurveBender key keeps that row, with its key actions, beside the shared one.
  it("shows both rows with an own key", () => {
    const html = render([shared, ownKey]);
    expect(html).toContain(">CurveBender<");
    expect(html).toContain("Actions for CurveBender custom key");
  });

  // TEST_SCENARIO: an install without the shared Connection keeps the one own-key row, offered for Connect.
  it("keeps the own-key row without the shared Connection", () => {
    const html = render([]);
    expect(html).not.toContain(">CurveBender<");
    expect(count(html, "CurveBender custom key")).toBe(1);
  });

  // TEST_SCENARIO: the shared row's explainer names the brand, links the docs in a new tab, states that the models are approved for restricted use cases only with that phrase linking the legal page, and offers only Close.
  it("explains the shared Connection", () => {
    const html = renderToStaticMarkup(
      createElement(CurveBenderInfoDialog, { onClose: () => {} }),
    );
    expect(html).toContain(
      "All Acme users are set up with CurveBender, IBM-hosted open-source models.",
    );
    expect(html).toContain(`href="${CURVE_BENDER_DOCS_URL}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toMatch(
      new RegExp(
        `These models are currently only approved for <a href="${CURVE_BENDER_RESTRICTIONS_URL}"[^>]*>restricted use cases</a>\\.`,
      ),
    );
    expect(html).toContain("Close");
  });

  // TEST_SCENARIO: an agent card names the shared Connection "CurveBender", and an own key by its preset name.
  it("names the shared Connection on an agent card", () => {
    const provider = (connectionId: string) =>
      sandboxSubtitleParts(
        {
          templateId: null,
          image: "img",
          grantedConnectionIds: [connectionId],
        } as never,
        {
          templateNameById: new Map(),
          connectionTemplateIdById: new Map([
            [shared.id, shared.templateId],
            [ownKey.id, ownKey.templateId],
          ]),
          slotUnit: null,
        },
      ).provider;
    expect(provider(shared.id)).toBe("CurveBender");
    expect(provider(ownKey.id)).toBe("CurveBender custom key");
  });
});
