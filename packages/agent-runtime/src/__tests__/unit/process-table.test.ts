import { describe, it, expect } from "vitest";
import {
  createProcFsProcessTable,
  parseProcStat,
} from "../../modules/acp/infrastructure/process-table.js";

/** A `/proc/<pid>/stat` line with the fields this adapter reads in place. */
function statLine(opts: {
  pid: number;
  comm: string;
  ppid: number;
  startTicks: number;
}): string {
  // Fields after `state`: ppid first, then on to starttime (field 22 of the
  // line, so the 19th of these).
  const fields = Array.from({ length: 50 }, (_, i) => String(i));
  fields[0] = String(opts.ppid);
  fields[18] = String(opts.startTicks);
  return `${opts.pid} (${opts.comm}) S ${fields.join(" ")}`;
}

describe("parseProcStat", () => {
  it("reads pid, ppid, start time and the executable name", () => {
    const line = statLine({
      pid: 300,
      comm: "sleep",
      ppid: 200,
      startTicks: 9,
    });

    expect(parseProcStat(line)).toEqual({
      pid: 300,
      ppid: 200,
      startTicks: 9,
      comm: "sleep",
    });
  });

  it("counts fields from the last ')', so a comm with spaces and parens is safe", () => {
    // The kernel does not escape the executable name; ") " inside it would
    // shift every field if counted from the first paren.
    const line = statLine({
      pid: 300,
      comm: "my (odd) proc",
      ppid: 200,
      startTicks: 9,
    });

    expect(parseProcStat(line)).toEqual({
      pid: 300,
      ppid: 200,
      startTicks: 9,
      comm: "my (odd) proc",
    });
  });

  it("rejects a line it cannot parse rather than inventing zeros", () => {
    expect(parseProcStat("")).toBeNull();
    expect(parseProcStat("300 (sleep) S")).toBeNull();
  });
});

describe("createProcFsProcessTable", () => {
  it("reads an empty table when procfs is absent, disabling tracking", () => {
    // Non-Linux dev hosts have no /proc; the reap path must not throw.
    const table = createProcFsProcessTable({
      procRoot: "/nonexistent-proc-root",
    });

    expect(table.read()).toEqual([]);
  });

  it("reads the real process table, including this process", () => {
    const table = createProcFsProcessTable();
    const entries = table.read();

    // Skipped where there is no procfs to read (macOS dev machines).
    if (!entries.length) return;
    const self = entries.find((e) => e.pid === process.pid);
    expect(self).toBeDefined();
    expect(self!.ppid).toBe(process.ppid);
    expect(self!.comm.length).toBeGreaterThan(0);
  });
});
