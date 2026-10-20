// TEST_OVERVIEW: The Processes list renders Login items in a section of their own. With only Login items it lists them rather than saying nothing runs; an agent that runs an older runtime, whose list carries no Login items, still renders, because every fetch parses the list through the schema that defaults them; a running item no entry names any more is listed and says so; an item that is off shows its command muted.
import type { ProcessList as ProcessListData } from "agent-runtime-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";

const runtime = vi.hoisted(() => ({ list: {} as unknown }));

vi.mock("../../query-client.js", () => ({ queryClient: {} }));
vi.mock("@tanstack/react-query", () => ({
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("../../modules/agents/agent-trpc.js", () => ({
  agentTrpc: () => ({
    processes: { list: { query: async () => runtime.list } },
  }),
  agentTrpcHttp: vi.fn(),
}));
vi.mock("../../modules/agents/api/queries.js", () => ({
  agentLacksLiveUpdates: () => false,
}));
vi.mock("../../modules/processes/hooks/use-toggle-process-output.js", () => ({
  useToggleProcessOutput: () => vi.fn(),
}));
vi.mock("../../store.js", () => ({
  useStore: (select: (s: Record<string, unknown>) => unknown) =>
    select({
      openProcessOutputKey: null,
      finishedListOpen: false,
      setFinishedListOpen: vi.fn(),
      showConfirm: vi.fn(),
    }),
}));

const { ProcessList } =
  await import("../../modules/processes/components/process-list.js");
const { fetchProcessList } =
  await import("../../modules/processes/api/client.js");

function render(list: ProcessListData) {
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(ProcessList, { agentId: "agent-a", list, alwaysOn: false }),
    ),
  );
}

const item = {
  id: "web",
  command: "npm run serve",
  disabled: false,
  running: false,
  listed: true,
  outputPath: "/home/agent/.local/state/rc/web.log",
};

describe("the Processes list", () => {
  // TEST_SCENARIO: nothing runs but the agent has a Login item; the list shows the item, not "Nothing is running".
  it("lists Login items when nothing else runs", () => {
    const html = render({
      running: [],
      finished: [],
      pendingRestart: null,
      startupItems: [item],
    });

    expect(html).toContain('data-testid="login-items"');
    expect(html).toContain("npm run serve");
    expect(html).not.toContain("Nothing is running");
  });

  // TEST_SCENARIO: an agent that has not restarted since this deploy runs the older runtime, which sends no startupItems; the fetch defaults them, and the list renders as before.
  it("renders the list of an older runtime that sends no Login items", async () => {
    runtime.list = { running: [], finished: [], pendingRestart: null };

    const list = await fetchProcessList("agent-a");

    expect(list.startupItems).toEqual([]);
    expect(render(list)).toContain("Nothing is running");
  });

  // TEST_SCENARIO: an item still runs although no entry names it any more; it stays listed so the user can stop it.
  it("lists a running item no entry names", () => {
    const html = render({
      running: [],
      finished: [],
      pendingRestart: null,
      startupItems: [{ ...item, running: true, listed: false }],
    });

    expect(html).toContain("Running, no longer in the list");
  });

  // TEST_SCENARIO: an item the user turned off shows its command muted, so the row reads as off at a glance and not only in its status line; an item that is on shows it at full strength.
  it("mutes the command of an item that is off", () => {
    const command = (html: string) =>
      /<span dir="rtl" class="([^"]*font-mono[^"]*)">/.exec(html)?.[1] ?? "";
    const off = render({
      running: [],
      finished: [],
      pendingRestart: null,
      startupItems: [{ ...item, disabled: true }],
    });
    const on = render({
      running: [],
      finished: [],
      pendingRestart: null,
      startupItems: [item],
    });

    expect(command(off)).toContain("text-muted-foreground");
    expect(command(on)).toContain("text-foreground");
    expect(command(on)).not.toContain("text-muted-foreground");
  });
});
