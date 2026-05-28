import { describe, it, expect, vi } from "vitest";
import { fetchOrFallback } from "../modules/agent/services/fetch-or-fallback.js";
import type { AgentService } from "../modules/agent/services/agent-service.js";
import type { AgentView } from "../modules/agent/domain/agent-view.js";
import { err, ok, type Result } from "../result.js";
import type {
  AuthRequiredError,
  TransportError,
} from "../modules/agent/domain/errors.js";

function makeAgent(overrides: Partial<AgentView> = {}): AgentView {
  return {
    id: "agent-1",
    name: "demo",
    templateId: "tmpl-x",
    image: "img:1",
    state: "starting",
    channels: [],
    allowedUserEmails: [],
    ...overrides,
  };
}

function makeService(
  getResult: () => Result<AgentView | null, TransportError | AuthRequiredError>,
): AgentService {
  return {
    list: vi.fn(async () => ok([])),
    get: vi.fn(async () => getResult()),
    deleteAgent: vi.fn(async () => ok(undefined)),
    restart: vi.fn(async () => ok(undefined)),
  };
}

describe("fetchOrFallback", () => {
  // The helper is the single guardrail that keeps `--json` paths from
  // emitting empty stdout when the post-action refresh fails. The
  // contract tested here applies identically to `create --wait --json`
  // (timeout branch) and `restart [--wait] --json`.

  it("returns the refreshed Agent when svc.get succeeds", async () => {
    const fresh = makeAgent({ state: "running" });
    const svc = makeService(() => ok(fresh));

    const result = await fetchOrFallback(svc, makeAgent(), "after restart");

    expect(result).toBe(fresh);
  });

  it("falls back to the caller-supplied snapshot when svc.get returns a transport error", async () => {
    const fallback = makeAgent({ state: "starting" });
    const svc = makeService(() =>
      err({ kind: "transport", reason: "ECONNREFUSED" }),
    );
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    const result = await fetchOrFallback(svc, fallback, "after wait timeout");

    expect(result).toBe(fallback);
    expect(stderr).toHaveBeenCalledWith(
      `warning: could not refresh agent "demo" after wait timeout; emitting last-known state\n`,
    );
    stderr.mockRestore();
  });

  it("falls back to the snapshot when svc.get returns ok(null) — agent vanished during refresh", async () => {
    const fallback = makeAgent();
    const svc = makeService(() => ok(null));
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    const result = await fetchOrFallback(svc, fallback, "after restart");

    expect(result).toBe(fallback);
    expect(stderr).toHaveBeenCalled();
    stderr.mockRestore();
  });
});
