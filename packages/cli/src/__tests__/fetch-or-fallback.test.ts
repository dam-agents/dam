import { describe, it, expect, vi } from "vitest";
import type { Instance } from "api-server-api";
import { fetchOrFallback } from "../modules/instance/services/fetch-or-fallback.js";
import type { InstanceService } from "../modules/instance/services/instance-service.js";
import { err, ok, type Result } from "../result.js";
import type {
  AuthRequiredError,
  TransportError,
} from "../modules/instance/domain/errors.js";

function makeInstance(overrides: Partial<Instance> = {}): Instance {
  return {
    id: "inst-1",
    name: "demo",
    agentId: "agt-1",
    templateId: "tmpl-x",
    image: "img:1",
    state: "starting",
    channels: [],
    allowedUserEmails: [],
    ...overrides,
  };
}

function makeService(
  getResult: () => Result<Instance | null, TransportError | AuthRequiredError>,
): InstanceService {
  return {
    list: vi.fn(async () => ok([])),
    get: vi.fn(async () => getResult()),
    deleteAgent: vi.fn(async () => ok(undefined)),
    deleteInstance: vi.fn(async () => ok(undefined)),
    restart: vi.fn(async () => ok(undefined)),
  };
}

describe("fetchOrFallback", () => {
  // The helper is the single guardrail that keeps `--json` paths from
  // emitting empty stdout when the post-action refresh fails. The
  // contract tested here applies identically to `create --wait --json`
  // (timeout branch) and `restart [--wait] --json`.

  it("returns the refreshed Instance when svc.get succeeds", async () => {
    const fresh = makeInstance({ state: "running" });
    const svc = makeService(() => ok(fresh));

    const result = await fetchOrFallback(svc, makeInstance(), "after restart");

    expect(result).toBe(fresh);
  });

  it("falls back to the caller-supplied snapshot when svc.get returns a transport error", async () => {
    const fallback = makeInstance({ state: "starting" });
    const svc = makeService(() =>
      err({ kind: "transport", reason: "ECONNREFUSED" }),
    );
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    const result = await fetchOrFallback(svc, fallback, "after wait timeout");

    expect(result).toBe(fallback);
    expect(stderr).toHaveBeenCalledWith(
      `warning: could not refresh instance "demo" after wait timeout; emitting last-known state\n`,
    );
    stderr.mockRestore();
  });

  it("falls back to the snapshot when svc.get returns ok(null) — instance vanished during refresh", async () => {
    const fallback = makeInstance();
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
