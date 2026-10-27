import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  install: { data: undefined as unknown, isError: false },
}));
vi.mock("../../modules/features/api/queries.js", () => ({
  useInstallCapabilities: () => h.install,
}));
vi.mock("../../modules/agents/hooks/use-agent-avatars.js", () => ({}));
vi.mock("../../modules/connections/api/queries.js", () => ({}));
vi.mock(
  "../../modules/connections/components/connection-catalog-modal.js",
  () => ({}),
);
vi.mock("../../modules/connections/hooks/use-catalog-groups.js", () => ({}));
vi.mock("../../modules/providers/components/provider-select.js", () => ({}));
vi.mock("../../modules/satellites/api/queries.js", () => ({}));
vi.mock(
  "../../modules/satellites/components/satellites-group-card.js",
  () => ({}),
);
vi.mock(
  "../../modules/sandboxes/components/granted-connections-panel.js",
  () => ({}),
);

import { VmRuntimeNotice } from "../../modules/agents/components/vm-runtime-notice.js";
import { LifecycleSetupSection } from "../../modules/sandboxes/components/setup/setup-sections.js";

const install = (virtualization: boolean) => ({
  virtualization,
  vmAgentSizing: "pool",
  idleTimeoutMinutes: { container: 60, vm: 5 },
});

beforeEach(() => {
  h.install = { data: install(true), isError: false };
});

const field = (value: number | null) =>
  renderToStaticMarkup(
    createElement(LifecycleSetupSection, { value, onChange: () => {} }),
  );

// TEST_SCENARIO: an untouched idle timeout is not sent (create-agent-input omits a null one), so a new agent hibernates after the install's default for its runtime. The field must show that default: 5 minutes for a microVM, not the 60 it showed in 0.2.23.
test("an untouched idle timeout shows the install's default for the runtime", () => {
  expect(field(null)).toContain('value="5"');
  h.install = { data: install(false), isError: false };
  expect(field(null)).toContain('value="60"');
});

// TEST_SCENARIO: a timeout the user set, and always-on as 0, still show as set.
test("a timeout the user set shows as set", () => {
  expect(field(30)).toContain('value="30"');
  expect(field(0)).toMatch(
    /aria-checked="true"[^>]*data-testid="lifecycle-always-on"/,
  );
});

// TEST_SCENARIO: every new agent on a virtualizing install is a microVM, and the Experimental features switch the old copy named is gone, so the notice states the runtime without pointing at a switch.
test("the microVM notice names no switch", () => {
  const html = renderToStaticMarkup(createElement(VmRuntimeNotice));
  expect(html).toContain(
    "This agent runs as a microVM on the new sandbox runtime.",
  );
  expect(html).not.toContain("Experimental");
});
