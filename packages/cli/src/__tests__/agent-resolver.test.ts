import { describe, it, expect, vi } from "vitest";
import { createAgentResolver } from "../modules/agent/services/agent-resolver.js";
import type { AgentService } from "../modules/agent/services/agent-service.js";
import type { AgentView } from "../modules/agent/domain/agent-view.js";
import { ok, type Result } from "../result.js";
import type {
  AuthRequiredError,
  TransportError,
} from "../modules/agent/domain/errors.js";

function makeAgent(overrides: Partial<AgentView> = {}): AgentView {
  return {
    id: "agent-1",
    name: "demo",
    templateId: null,
    image: "",
    state: "running",
    channels: [],
    allowedUserEmails: [],
    ...overrides,
  };
}

function makeService(stub: {
  list?: () => Result<readonly AgentView[], TransportError | AuthRequiredError>;
  get?: (
    id: string,
  ) => Result<AgentView | null, TransportError | AuthRequiredError>;
}): AgentService {
  return {
    list: vi.fn(async () => stub.list?.() ?? ok([])),
    get: vi.fn(async (id: string) => stub.get?.(id) ?? ok(null)),
    deleteAgent: vi.fn(async () => ok(undefined)),
    restart: vi.fn(async () => ok(undefined)),
    updateAllowedUserEmails: vi.fn(async () => ok(makeAgent())),
  };
}

describe("agent-resolver", () => {
  describe("ID branch (ref starts with 'agent-')", () => {
    it("returns the agent on a happy-path ID lookup", async () => {
      const agent = makeAgent({ id: "agent-42", name: "prod" });
      const resolver = createAgentResolver({
        agentService: makeService({ get: () => ok(agent) }),
      });

      const result = await resolver.resolve("agent-42");

      expect(result).toEqual({ ok: true, value: agent });
    });

    it("maps the service's null (NOT_FOUND-equivalent) to NotFoundError via 'id'", async () => {
      const resolver = createAgentResolver({
        agentService: makeService({ get: () => ok(null) }),
      });

      const result = await resolver.resolve("agent-missing");

      expect(result).toEqual({
        ok: false,
        error: { kind: "not-found", ref: "agent-missing", via: "id" },
      });
    });
  });

  describe("name branch (ref does not start with 'agent-')", () => {
    it("returns the single matching agent", async () => {
      const agent = makeAgent({ name: "prod" });
      const resolver = createAgentResolver({
        agentService: makeService({
          list: () =>
            ok([makeAgent({ id: "agent-other", name: "staging" }), agent]),
        }),
      });

      const result = await resolver.resolve("prod");

      expect(result).toEqual({ ok: true, value: agent });
    });

    it("returns NotFoundError via 'name' when zero matches", async () => {
      const resolver = createAgentResolver({
        agentService: makeService({
          list: () => ok([makeAgent({ name: "staging" })]),
        }),
      });

      const result = await resolver.resolve("prod");

      expect(result).toEqual({
        ok: false,
        error: { kind: "not-found", ref: "prod", via: "name" },
      });
    });

    it("returns AmbiguousError when two or more match (legacy duplicates)", async () => {
      const a = makeAgent({ id: "agent-A", name: "prod" });
      const b = makeAgent({ id: "agent-B", name: "prod" });
      const c = makeAgent({ id: "agent-C", name: "other" });
      const resolver = createAgentResolver({
        agentService: makeService({ list: () => ok([a, b, c]) }),
      });

      const result = await resolver.resolve("prod");

      expect(result).toEqual({
        ok: false,
        error: {
          kind: "ambiguous",
          ref: "prod",
          matches: [
            { id: "agent-A", name: "prod" },
            { id: "agent-B", name: "prod" },
          ],
        },
      });
    });

    it("matches exact case (no normalization) — 'Prod' does not match 'prod'", async () => {
      // Deliberate contract: a future `.toLowerCase()` or `.trim()` would
      // silently break addressing, so the resolver pins case-sensitivity.
      const resolver = createAgentResolver({
        agentService: makeService({
          list: () => ok([makeAgent({ name: "prod" })]),
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
