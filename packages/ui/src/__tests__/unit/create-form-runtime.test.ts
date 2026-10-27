import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  install: { data: undefined as unknown, isError: false },
}));
vi.mock("../../modules/features/api/queries.js", () => ({
  useInstallCapabilities: () => h.install,
}));

import { VmRuntimeNotice } from "../../modules/agents/components/vm-runtime-notice.js";
import { useVmRuntime } from "../../modules/features/hooks/use-vm-runtime.js";

const install = (virtualization: boolean) => ({
  virtualization,
  vmAgentSizing: "pool",
  idleTimeoutMinutes: { container: 60, vm: 5 },
});

beforeEach(() => {
  h.install = { data: install(true), isError: false };
});

// TEST_SCENARIO: an untouched idle timeout is not sent, so a new VM agent hibernates after the install's VM default. The form must show that default, not the container default it showed in 0.2.23.
test("the idle timeout shows the install's default for the new agent's runtime", () => {
  expect(useVmRuntime().idleTimeoutMin).toBe(5);
  h.install = { data: install(false), isError: false };
  expect(useVmRuntime().idleTimeoutMin).toBe(60);
});

// TEST_SCENARIO: every new agent on a virtualizing install is a microVM, and the Experimental features switch the old copy named is gone, so the notice states the runtime without pointing at a switch.
test("the microVM notice names no switch", () => {
  const html = renderToStaticMarkup(createElement(VmRuntimeNotice));
  expect(html).toContain(
    "This agent runs as a microVM on the new sandbox runtime.",
  );
  expect(html).not.toContain("Experimental");
});
