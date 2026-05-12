import { describe, it, expect, vi } from "vitest";
import type { Instance } from "api-server-api";
import { createInstanceResolver } from "../modules/instances/services/instance-resolver.js";
import type { InstancesService } from "../modules/instances/services/instances-service.js";
import { ok, type Result } from "../result.js";
import type {
  AuthRequiredError,
  TransportError,
} from "../modules/instances/domain/errors.js";

function makeInstance(overrides: Partial<Instance> = {}): Instance {
  return {
    id: "inst-1",
    name: "demo",
    agentId: "agt-1",
    state: "running",
    channels: [],
    allowedUserEmails: [],
    ...overrides,
  };
}

function makeService(stub: {
  list?: () => Result<readonly Instance[], TransportError | AuthRequiredError>;
  get?: (id: string) => Result<Instance | null, TransportError | AuthRequiredError>;
}): InstancesService {
  return {
    list: vi.fn(async () => stub.list?.() ?? ok([])),
    get: vi.fn(async (id: string) => stub.get?.(id) ?? ok(null)),
  };
}

describe("instance-resolver", () => {
  describe("ID branch (ref starts with 'inst-')", () => {
    it("returns the instance on a happy-path ID lookup", async () => {
      const inst = makeInstance({ id: "inst-42", name: "prod" });
      const resolver = createInstanceResolver({
        instancesService: makeService({ get: () => ok(inst) }),
      });

      const result = await resolver.resolve("inst-42");

      expect(result).toEqual({ ok: true, value: inst });
    });

    it("maps the service's null (NOT_FOUND-equivalent) to NotFoundError via 'id'", async () => {
      const resolver = createInstanceResolver({
        instancesService: makeService({ get: () => ok(null) }),
      });

      const result = await resolver.resolve("inst-missing");

      expect(result).toEqual({
        ok: false,
        error: { kind: "not-found", ref: "inst-missing", via: "id" },
      });
    });
  });

  describe("name branch (ref does not start with 'inst-')", () => {
    it("returns the single matching instance", async () => {
      const inst = makeInstance({ name: "prod" });
      const resolver = createInstanceResolver({
        instancesService: makeService({
          list: () => ok([makeInstance({ id: "inst-other", name: "staging" }), inst]),
        }),
      });

      const result = await resolver.resolve("prod");

      expect(result).toEqual({ ok: true, value: inst });
    });

    it("returns NotFoundError via 'name' when zero matches", async () => {
      const resolver = createInstanceResolver({
        instancesService: makeService({
          list: () => ok([makeInstance({ name: "staging" })]),
        }),
      });

      const result = await resolver.resolve("prod");

      expect(result).toEqual({
        ok: false,
        error: { kind: "not-found", ref: "prod", via: "name" },
      });
    });

    it("returns AmbiguousError when two or more match (legacy duplicates)", async () => {
      const a = makeInstance({ id: "inst-A", name: "prod" });
      const b = makeInstance({ id: "inst-B", name: "prod" });
      const c = makeInstance({ id: "inst-C", name: "other" });
      const resolver = createInstanceResolver({
        instancesService: makeService({ list: () => ok([a, b, c]) }),
      });

      const result = await resolver.resolve("prod");

      expect(result).toEqual({
        ok: false,
        error: {
          kind: "ambiguous",
          ref: "prod",
          matches: [
            { id: "inst-A", name: "prod" },
            { id: "inst-B", name: "prod" },
          ],
        },
      });
    });

    it("matches exact case (no normalization) — 'Prod' does not match 'prod'", async () => {
      // Deliberate contract: a future `.toLowerCase()` or `.trim()` would
      // silently break addressing, so the resolver pins case-sensitivity.
      const resolver = createInstanceResolver({
        instancesService: makeService({
          list: () => ok([makeInstance({ name: "prod" })]),
        }),
      });

      const result = await resolver.resolve("Prod");

      expect(result).toEqual({
        ok: false,
        error: { kind: "not-found", ref: "Prod", via: "name" },
      });
    });
  });
});
