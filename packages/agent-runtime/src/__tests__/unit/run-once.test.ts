import { describe, expect, it } from "vitest";

import { describeFailure, runOnce } from "../../core/run-once.js";

/**
 * TEST_OVERVIEW: one subprocess, run to completion, reported as a value.
 *
 * Every caller that used to hand-roll spawn/decode/deadline now shares this
 * unit, so the properties they each got subtly wrong are pinned here once: a
 * deadline that kills, a byte budget on retained output, decoding that
 * survives a multi-byte character split across stream chunks, and failure
 * reported as a value rather than thrown — including the errors spawn raises
 * synchronously. Output is either retained and returned or relayed line by
 * line; a relaying caller streams without retaining, so a long build cannot be
 * capped out of existence, and only one partial line is ever held.
 */

const node = (script: string): string[] => ["node", "-e", script];

describe("runOnce", () => {
  /**
   * TEST_SCENARIO: A command that succeeds returns its captured streams, with
   * stdout and stderr kept apart.
   */
  it("should return captured stdout and stderr on success", async () => {
    const result = await runOnce({
      command: node(
        "process.stdout.write('out'); process.stderr.write('warn')",
      ),
      timeoutMs: 5_000,
    });
    expect(result).toEqual({
      ok: true,
      value: { stdout: "out", stderr: "warn" },
    });
  });

  /**
   * TEST_SCENARIO: A non-zero exit is a value, not an exception, and carries
   * the code plus stderr so a caller can build its own message.
   */
  it("should report a non-zero exit as a failure value", async () => {
    const result = await runOnce({
      command: node("process.stderr.write('boom'); process.exit(3)"),
      timeoutMs: 5_000,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: "exited", code: 3, stderr: "boom" });
    expect(describeFailure("git clone", result.error)).toBe(
      "git clone exited 3: boom",
    );
  });

  /**
   * TEST_SCENARIO: A command that outlives its deadline is killed and
   * reported as timed out — the promise must never hang on the child.
   */
  it("should kill and report a command that outlives its deadline", async () => {
    const result = await runOnce({
      command: node("setTimeout(() => {}, 60000)"),
      timeoutMs: 20,
    });
    expect(result).toEqual({
      ok: false,
      error: { kind: "timed-out", timeoutMs: 20 },
    });
  });

  /**
   * TEST_SCENARIO: A binary that does not exist fails as not-spawnable rather
   * than throwing out of the promise.
   */
  it("should report an unspawnable command as a failure value", async () => {
    const result = await runOnce({
      command: ["definitely-not-a-real-binary-xyz"],
      timeoutMs: 5_000,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("not-spawnable");
  });

  /**
   * TEST_SCENARIO: An empty command is a programming error, reported the same
   * way rather than crashing on a missing binary name.
   */
  it("should reject an empty command", async () => {
    const result = await runOnce({ command: [], timeoutMs: 5_000 });
    expect(result).toEqual({
      ok: false,
      error: { kind: "not-spawnable", message: "empty command" },
    });
  });

  /**
   * TEST_SCENARIO: The byte budget is enforced in bytes, not UTF-16 units,
   * and exceeding it kills the child instead of buffering without bound.
   */
  it("should cap retained output by bytes", async () => {
    const result = await runOnce({
      command: node("process.stdout.write('日'.repeat(1000))"),
      timeoutMs: 5_000,
      maxOutputBytes: 100,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      kind: "output-capped",
      maxOutputBytes: 100,
    });
  });

  /**
   * TEST_SCENARIO: The pipe delivers bytes, so a chunk boundary can land
   * inside a multi-byte character. Decoding per chunk would substitute
   * U+FFFD; the runner must reassemble the character exactly.
   */
  it("should reassemble a multi-byte character split across chunks", async () => {
    const script = `
      const text = "překlad — 日本語";
      const bytes = Buffer.from(text, "utf8");
      const cut = Buffer.byteLength("překlad — ", "utf8") + 1;
      process.stdout.write(bytes.subarray(0, cut));
      setTimeout(() => process.stdout.write(bytes.subarray(cut)), 30);
    `;
    const result = await runOnce({ command: node(script), timeoutMs: 5_000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stdout).toBe("překlad — 日本語");
    expect(result.value.stdout).not.toContain("�");
  });

  /**
   * TEST_SCENARIO: A relaying caller gets whole lines as they arrive, from
   * both streams, including a final line with no trailing newline — and
   * nothing is retained, so streaming a long run cannot trip the budget.
   */
  it("should relay whole lines without retaining them", async () => {
    const lines: string[] = [];
    const result = await runOnce({
      command: node(
        "process.stdout.write('first\\nsec'); process.stderr.write('err\\n'); setTimeout(() => process.stdout.write('ond\\nlast'), 20)",
      ),
      timeoutMs: 5_000,
      maxOutputBytes: 4,
      onLine: (line) => lines.push(line),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stdout).toBe("");
    expect(lines.sort()).toEqual(["err", "first", "last", "second"]);
  });

  /**
   * TEST_SCENARIO: spawn rejects a malformed argv synchronously, before any
   * event can fire. A runner whose contract is "failure is a value" must
   * report that the same way, so no caller has to attach a catch.
   */
  it("should report a malformed argv as a failure value, not a rejection", async () => {
    const result = await runOnce({ command: [""], timeoutMs: 5_000 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("not-spawnable");
  });

  /**
   * TEST_SCENARIO: A stream can produce megabytes without ever sending a
   * newline — a build writing a progress meter with carriage returns does
   * exactly this. The line-reassembly buffer must stay bounded, so the partial
   * line is relayed instead of growing for the length of the run.
   */
  it("should relay a partial line rather than buffer a newline-less stream without bound", async () => {
    const lines: string[] = [];
    const result = await runOnce({
      command: node(
        "for (let i = 0; i < 3; i++) process.stdout.write('x'.repeat(1024 * 1024))",
      ),
      timeoutMs: 20_000,
      onLine: (line) => lines.push(line),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stdout).toBe("");
    expect(lines.length).toBeGreaterThan(1);
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThan(
      3 * 1024 * 1024,
    );
    expect(lines.join("").length).toBe(3 * 1024 * 1024);
  });
});
