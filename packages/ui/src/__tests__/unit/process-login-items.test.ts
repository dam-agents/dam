// TEST_OVERVIEW: the Processes panel shows Startup Items as Login items, in a section of their own: a running item's row leaves the background groups and the indicator's counts, an item without a running row still opens its log by its id, and its status and caption say whether it is off by the user's choice.
import type { ProcessList, ProcessRow, StartupItem } from "agent-runtime-api";
import { describe, expect, test } from "vitest";

import { findListedProcess } from "../../modules/processes/lib/listed-process.js";
import {
  loginItemBootCaption,
  loginItemOutputKey,
  loginItemStatus,
  processKindLabel,
} from "../../modules/processes/lib/process-copy.js";
import { groupProcesses } from "../../modules/processes/lib/process-groups.js";
import { summarizeProcesses } from "../../modules/processes/lib/process-summary.js";

function row(key: string, kind: ProcessRow["kind"]): ProcessRow {
  return {
    key,
    kind,
    pid: 1,
    command: `command of ${key}`,
    startedAt: "2026-10-19T10:00:00Z",
    cpuPercent: null,
    rssBytes: null,
    outputPath: null,
    keepsAwake: false,
    keepSource: "default",
    container: null,
  };
}

function item(over: Partial<StartupItem>): StartupItem {
  return {
    id: "web",
    command: "npm run serve",
    disabled: false,
    running: false,
    outputPath: "/home/agent/.platform/startup-logs/web.log",
    ...over,
  };
}

describe("login items", () => {
  // TEST_SCENARIO: a running Startup Item has a row in the scan, but the panel lists it once, under Login items, so it stays out of the background groups and of the indicator's count of what runs in the background.
  test("keeps a running item out of the background groups and counts", () => {
    const running = [row("detached", "detached"), row("item", "startup-item")];
    const list: ProcessList = {
      running,
      finished: [],
      pendingRestart: null,
      startupItems: [item({ running: true })],
    };

    const listed = groupProcesses(running, false).flatMap((g) => g.rows);
    expect(listed.map((r) => r.key)).toEqual(["detached"]);
    expect(summarizeProcesses(list).running).toBe(1);
    expect(processKindLabel(row("item", "startup-item"))).toBe("Login item");
  });

  // TEST_SCENARIO: an item that is off or exited has no running row, yet the user can still read what its last runs wrote; its log opens under a key made from its id.
  test("opens an item's log by its id when it has no running row", () => {
    const list: ProcessList = {
      running: [],
      finished: [],
      pendingRestart: null,
      startupItems: [item({ disabled: true })],
    };

    expect(findListedProcess(list, loginItemOutputKey("web"))).toEqual({
      command: "npm run serve",
      outputPath: "/home/agent/.platform/startup-logs/web.log",
      status: "Off",
      running: false,
    });
  });

  // TEST_SCENARIO: a disabled item is the user's decision, and the agent cannot undo it, so the menu says so; otherwise the agent set it up.
  test("says who decided whether an item starts", () => {
    expect(loginItemStatus(item({ running: true }))).toBe("Running");
    expect(loginItemStatus(item({}))).toBe("Not running");
    expect(loginItemBootCaption(item({ disabled: true }))).toBe(
      "Your choice. The agent can't turn it back on.",
    );
    expect(loginItemBootCaption(item({}))).toBe("Set up by the agent");
  });
});
