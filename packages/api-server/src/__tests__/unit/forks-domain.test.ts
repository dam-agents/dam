import { describe, it, expect } from "vitest";
import {
  createFork,
  isTerminal,
  markCompleted,
  markFailed,
  markReady,
  toForeignSub,
  type Fork,
} from "../../modules/forks/domain/fork.js";

function makeFork(): Fork {
  return createFork({
    forkId: "fork-1",
    replyId: "reply-1",
    spec: {
      agentId: "inst-1",
      foreignSub: toForeignSub("kc|user-42"),
    },
  });
}

describe("toForeignSub", () => {
  it("rejects empty strings", () => {
    expect(() => toForeignSub("")).toThrow();
  });
});

describe("Fork state machine", () => {
  it("starts in Pending phase", () => {
    expect(makeFork().status.phase).toBe("Pending");
  });

  it("transitions Pending → Ready with a podIP", () => {
    const result = markReady(makeFork(), "10.0.0.5");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fork.status).toEqual({ phase: "Ready", podIP: "10.0.0.5" });
    }
  });

  it("rejects Ready without a podIP", () => {
    const result = markReady(makeFork(), "");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("MissingPodIP");
  });

  it("transitions Pending → Failed", () => {
    const result = markFailed(makeFork(), "CredentialMintFailed", "401");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fork.status.phase).toBe("Failed");
      expect(result.fork.status.error).toEqual({
        reason: "CredentialMintFailed",
        detail: "401",
      });
    }
  });

  it("transitions Ready → Failed", () => {
    const ready = markReady(makeFork(), "10.0.0.5");
    if (!ready.ok) throw new Error("setup failed");
    const failed = markFailed(ready.fork, "PodNotReady");
    expect(failed.ok).toBe(true);
    if (failed.ok) expect(failed.fork.status.phase).toBe("Failed");
  });

  it("transitions Ready → Completed", () => {
    const ready = markReady(makeFork(), "10.0.0.5");
    if (!ready.ok) throw new Error("setup failed");
    const completed = markCompleted(ready.fork);
    expect(completed.ok).toBe(true);
    if (completed.ok) expect(completed.fork.status.phase).toBe("Completed");
  });

  it("rejects Pending → Completed (Completed requires Ready first)", () => {
    const result = markCompleted(makeFork());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("IllegalTransition");
  });

  it("rejects Completed → Failed (terminal state stays terminal)", () => {
    const ready = markReady(makeFork(), "10.0.0.5");
    if (!ready.ok) throw new Error("setup failed");
    const completed = markCompleted(ready.fork);
    if (!completed.ok) throw new Error("setup failed");
    const result = markFailed(completed.fork, "Timeout");
    expect(result.ok).toBe(false);
  });

  it("rejects Failed → Ready (terminal state stays terminal — no fallback to owner)", () => {
    const failed = markFailed(makeFork(), "CredentialMintFailed");
    if (!failed.ok) throw new Error("setup failed");
    const result = markReady(failed.fork, "10.0.0.5");
    expect(result.ok).toBe(false);
  });

  it("rejects Failed → Completed", () => {
    const failed = markFailed(makeFork(), "Timeout");
    if (!failed.ok) throw new Error("setup failed");
    const result = markCompleted(failed.fork);
    expect(result.ok).toBe(false);
  });

  it("preserves the single ForeignSub binding across transitions", () => {
    const fork = makeFork();
    const ready = markReady(fork, "10.0.0.5");
    if (!ready.ok) throw new Error("setup failed");
    expect(ready.fork.spec.foreignSub).toBe(fork.spec.foreignSub);
    const completed = markCompleted(ready.fork);
    if (!completed.ok) throw new Error("setup failed");
    expect(completed.fork.spec.foreignSub).toBe(fork.spec.foreignSub);
  });

  it("isTerminal flags Failed and Completed", () => {
    const fork = makeFork();
    expect(isTerminal(fork)).toBe(false);
    const ready = markReady(fork, "10.0.0.5");
    if (!ready.ok) throw new Error("setup failed");
    expect(isTerminal(ready.fork)).toBe(false);

    const completed = markCompleted(ready.fork);
    if (!completed.ok) throw new Error("setup failed");
    expect(isTerminal(completed.fork)).toBe(true);

    const failed = markFailed(fork, "Timeout");
    if (!failed.ok) throw new Error("setup failed");
    expect(isTerminal(failed.fork)).toBe(true);
  });
});
