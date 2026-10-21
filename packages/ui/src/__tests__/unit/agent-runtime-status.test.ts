// TEST_OVERVIEW: the agent's configuration says where the agent runs, a container
// TEST_OVERVIEW: or a VM, and shows a move between them in a status region, with
// TEST_OVERVIEW: the controller's reason as visible text. An operator starts and
// TEST_OVERVIEW: ends the move, so the owner gets no control over it.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { AgentRuntimeStatus } from "../../modules/agents/components/agent-runtime-status.js";
import type { RuntimeMigrationView } from "../../types.js";

function render(vm: boolean, runtimeMigration: RuntimeMigrationView | null) {
  return renderToStaticMarkup(
    createElement(AgentRuntimeStatus, { agent: { vm, runtimeMigration } }),
  );
}

// TEST_SCENARIO: a settled agent names its runtime and nothing else, and its status region is still mounted so a move that starts later is announced.
it("names the runtime of a settled agent", () => {
  expect(render(false, null)).toContain("Runs in a container");
  const vm = render(true, null);
  expect(vm).toContain("Runs in a VM");
  expect(vm).toContain('role="status"');
  expect(vm).not.toContain("Migrating");
});

// TEST_SCENARIO: a move under way shows its phase inside the status region and its reason as text, and offers no button.
it("shows a move in progress", () => {
  const html = render(false, {
    phase: "copying",
    message: "copying 2 GiB",
  });
  expect(html).toMatch(/role="status"[^>]*>.*Migrating: copying/);
  expect(html).toContain("copying 2 GiB");
  expect(html).not.toContain("<button");
});

// TEST_SCENARIO: a failed move reads as a failure and says an operator ends it, since the owner cannot retry or undo it.
it("shows a failed move and who ends it", () => {
  const html = render(false, { phase: "failed", message: "runner is full" });
  expect(html).toContain("Migration failed");
  expect(html).toContain("runner is full");
  expect(html).toContain("operator");
});
