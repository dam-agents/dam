// TEST_OVERVIEW: the agent's configuration says where the agent runs, a container
// TEST_OVERVIEW: or a VM, and shows a move between them in a status region that
// TEST_OVERVIEW: is never hidden, with the controller's reason as visible text and,
// TEST_OVERVIEW: once a move it watched ends, a sentence that says how. An operator
// TEST_OVERVIEW: starts and ends the move, so the owner gets no control over it.
// TEST_OVERVIEW: The block shows in the default layout only.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import {
  AgentRuntimeStatusView,
  movedAgentAfter,
} from "../../modules/agents/components/agent-runtime-status.js";
import { SandboxIdentity } from "../../modules/sandboxes/components/sandbox-home-header.js";
import type { AgentView, RuntimeMigrationView } from "../../types.js";

const env = vi.hoisted(() => ({ newLayout: false }));
vi.mock("../../modules/features/hooks/use-new-layout.js", () => ({
  useNewLayout: () => env.newLayout,
}));
vi.mock("../../modules/agents/components/editable-agent-identity.js", () => ({
  EditableAgentIdentity: () => null,
}));
vi.mock("../../modules/agents/components/avatar/agent-avatar.js", () => ({
  avatarMood: () => "idle",
}));
vi.mock("../../modules/agents/components/update-available-action.js", () => ({
  UpdateAvailableAction: () => null,
}));
vi.mock("../../modules/agents/hooks/use-update-sandbox.js", () => ({
  useUpdateSandbox: () => ({}),
}));
vi.mock("../../modules/agents/components/gateway-failure-badge.js", () => ({
  GatewayFailureBadge: () => null,
}));

function agent(
  vm: boolean,
  runtimeMigration: RuntimeMigrationView | null,
): Pick<AgentView, "id" | "vm" | "runtimeMigration"> {
  return { id: "a", vm, runtimeMigration };
}

function render(
  a: Pick<AgentView, "id" | "vm" | "runtimeMigration">,
  moveEnded = false,
) {
  return renderToStaticMarkup(
    createElement(AgentRuntimeStatusView, { agent: a, moveEnded }),
  );
}

function statusRegion(html: string) {
  return /<div role="status"([^>]*)>/.exec(html)?.[1] ?? null;
}

// TEST_SCENARIO: a settled agent names its runtime, inside a status region that is rendered and not hidden, so a move that starts later is announced.
it("names the runtime of a settled agent in a visible status region", () => {
  expect(render(agent(false, null))).toContain("Runs in a container");
  const html = render(agent(true, null));
  expect(html).toContain("Runs in a VM");
  const attrs = statusRegion(html);
  expect(attrs).not.toBeNull();
  expect(attrs).not.toMatch(/hidden|sr-only/);
  expect(html).not.toContain("Migrating");
});

// TEST_SCENARIO: a move under way shows its phase and its reason inside the status region, gives the reason once rather than also as a tooltip, and offers no button.
it("shows a move in progress", () => {
  const html = render(
    agent(false, { phase: "copying", message: "copying 2 GiB" }),
  );
  expect(html).toMatch(/role="status".*Migrating: copying.*copying 2 GiB/);
  expect(html.match(/copying 2 GiB/g)).toHaveLength(1);
  expect(html).not.toContain("title=");
  expect(html).not.toContain("<button");
});

// TEST_SCENARIO: a failed move reads as a failure and says an operator ends it, since the owner cannot retry or undo it.
it("shows a failed move and who ends it", () => {
  const html = render(agent(false, { phase: "failed", message: "full" }));
  expect(html).toContain("Migration failed");
  expect(html).toContain("full");
  expect(html).toContain("operator");
});

// TEST_SCENARIO: a live region does not announce removed text, so when a watched move ends the region gains a sentence saying how it ended: in a VM after a finished move, in a container after an undone one. An agent this page never saw moving gets no such sentence.
it("announces the end of a move it watched", () => {
  const steps = [
    agent(false, null),
    agent(false, { phase: "booting" }),
    agent(true, null),
  ];
  let moved: string | null = null;
  const htmls = steps.map((a) => {
    moved = movedAgentAfter(moved, a);
    return render(a, moved === a.id && !a.runtimeMigration);
  });
  expect(htmls[0]).not.toContain("The move");
  expect(htmls[1]).toContain("Migrating: booting");
  expect(htmls[2]).toMatch(
    /role="status".*The move finished\. The agent now runs in a VM\./,
  );
  expect(render(agent(false, null), true)).toContain(
    "The agent still runs in a container.",
  );
  expect(movedAgentAfter("a", { id: "b", runtimeMigration: null })).toBe("a");
});

describe("SandboxIdentity", () => {
  const full = {
    ...agent(true, { phase: "copying" }),
    name: "a",
    avatar: null,
    hibernationTimeoutMin: 30,
    access: { role: "owner", editors: [] },
  } as unknown as AgentView;
  const renderIdentity = () =>
    renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(SandboxIdentity, {
          agent: full,
          display: { state: "running" } as never,
        }),
      ),
    );

  beforeEach(() => {
    env.newLayout = false;
  });

  // TEST_SCENARIO: the runtime block belongs to the default layout; the experimental JanUI shares this page and stays as it was.
  it("shows the runtime block in the default layout only", () => {
    expect(renderIdentity()).toContain("Runs in a VM");
    env.newLayout = true;
    const html = renderIdentity();
    expect(html).not.toContain("Runs in a VM");
    expect(html).not.toContain("Migrating");
  });
});
