// TEST_OVERVIEW: the Processes panel shows a container row by what it is: its engine and kind in the caption, its short id as the title in place of the shim command line, and below the user's own detached work in its group.
import type { ProcessRow } from "agent-runtime-api";
import { describe, expect, test } from "vitest";

import {
  processKindLabel,
  processTitle,
} from "../../modules/processes/lib/process-copy.js";
import { groupProcesses } from "../../modules/processes/lib/process-groups.js";

function row(
  key: string,
  container: ProcessRow["container"],
  startedAt = "2026-10-13T10:00:00Z",
): ProcessRow {
  return {
    key,
    kind: "detached",
    pid: 1,
    command: `command of ${key}`,
    startedAt,
    cpuPercent: null,
    rssBytes: null,
    outputPath: null,
    keepsAwake: false,
    keepSource: "default",
    container,
  };
}

const container = row("shim", {
  role: "container",
  engine: "docker",
  id: "3f2a9c1b4e5d",
});
const runtime = row("k3s", { role: "runtime", engine: "k3s" });
const plain = row("sleep", null, "2026-10-13T11:00:00Z");

describe("container row copy", () => {
  test("names a container by its engine and short id", () => {
    expect(processKindLabel(container)).toBe("Docker container");
    expect(processTitle(container)).toBe("3f2a9c1b4e5d");
  });

  test("keeps a runtime's command and names its engine", () => {
    expect(processKindLabel(runtime)).toBe("k3s runtime");
    expect(processTitle(runtime)).toBe("command of k3s");
  });

  test("leaves a plain detached process as it was", () => {
    expect(processKindLabel(plain)).toBe("Detached");
    expect(processTitle(plain)).toBe("command of sleep");
  });
});

describe("container row order", () => {
  test("lists the user's own work first, then runtimes, then containers", () => {
    const [group] = groupProcesses([container, runtime, plain], false);
    expect(group?.rows.map((r) => r.key)).toEqual(["sleep", "k3s", "shim"]);
  });
});
