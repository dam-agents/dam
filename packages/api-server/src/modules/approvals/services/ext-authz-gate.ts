import { randomUUID } from "node:crypto";
import type { ApprovalsRepository } from "../infrastructure/approvals-repository.js";
import type { RedisBus } from "../../../core/redis-bus.js";
import {
  buildExtAuthzSynthFrame,
  injectChannelOf,
} from "../infrastructure/acp-frames.js";

export type ExtAuthzVerdict = "allow" | "deny";

export interface ExtAuthzGateInput {
  instanceId: string;
  host: string;
  method: string;
  path: string;
}

/**
 * Server-internal port for Envoy's ext_authz HTTP handler. Encapsulates the
 * full HITL flow: identity resolution, rule lookup, pending-row creation,
 * synth-frame fan-out, synchronous hold, wake-up, timeout, expiry. The
 * handler in `apps/ext-authz` is reduced to HTTP shape.
 */
export interface ExtAuthzGate {
  gateRequest(input: ExtAuthzGateInput): Promise<ExtAuthzVerdict>;
}

/**
 * Cross-module ports the gate consumes. Composition root supplies
 * implementations that delegate to the appropriate module's repository —
 * keeps approvals from importing from agents- or egress-rules-modules
 * directly.
 */
export interface InstanceIdentityResolver {
  resolve(instanceId: string): Promise<{ ownerSub: string; agentId: string } | null>;
}

export interface EgressRuleMatcher {
  match(
    agentId: string,
    host: string,
    method: string,
    path: string,
  ): Promise<{ verdict: ExtAuthzVerdict } | null>;
}

export interface CreateExtAuthzGateDeps {
  repo: ApprovalsRepository;
  bus: RedisBus;
  identityResolver: InstanceIdentityResolver;
  ruleMatcher: EgressRuleMatcher;
  /** Bounded synchronous hold; the durable pending row outlives this. */
  holdSeconds: number;
}

export function createExtAuthzGate(deps: CreateExtAuthzGateDeps): ExtAuthzGate {
  return {
    async gateRequest({ instanceId, host, method, path }) {
      const identity = await deps.identityResolver.resolve(instanceId);
      if (!identity) return "deny";

      const matched = await deps.ruleMatcher.match(identity.agentId, host, method, path);
      if (matched) return matched.verdict;

      const pendingId = randomUUID();
      await deps.repo.insertPending({
        id: pendingId,
        type: "ext_authz",
        instanceId,
        agentId: identity.agentId,
        ownerSub: identity.ownerSub,
        sessionId: null,
        payload: { kind: "ext_authz", host, method, path },
        expiresAt: new Date(Date.now() + deps.holdSeconds * 1000),
      });

      // Synth-frame fan-out: any replica holding a WS for this instance
      // picks it up via the relay's `inject:<instanceId>` subscription.
      const frame = buildExtAuthzSynthFrame({ approvalId: pendingId, host, method, path });
      void deps.bus.publish(injectChannelOf(instanceId), frame);

      return waitForVerdict(deps, pendingId);
    },
  };
}

async function waitForVerdict(
  deps: CreateExtAuthzGateDeps,
  id: string,
): Promise<ExtAuthzVerdict> {
  // Re-read the row up front: a verdict written between INSERT and
  // SUBSCRIBE would otherwise be missed. Postgres is the truth path.
  const initial = await deps.repo.getPending(id);
  if (initial && initial.status === "resolved") return verdictOf(initial.verdict);

  return new Promise<ExtAuthzVerdict>((resolve) => {
    let settled = false;
    const settle = (v: ExtAuthzVerdict) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(v);
    };

    const unsubscribe = deps.bus.subscribe(`approval:${id}`, async () => {
      const row = await deps.repo.getPending(id);
      if (!row || row.status !== "resolved") return;
      settle(verdictOf(row.verdict));
    });

    const timeout = setTimeout(async () => {
      // Mark expired so the inbox shows the row's terminal state. The
      // egress rules path is unaffected — a future approve-permanent still
      // writes a rule that the agent's next retry consumes.
      await deps.repo.expirePending(id).catch(() => {});
      settle("deny");
    }, deps.holdSeconds * 1000);
    timeout.unref();

    function cleanup() {
      unsubscribe();
      clearTimeout(timeout);
    }
  });
}

function verdictOf(v: string | null): ExtAuthzVerdict {
  if (v === "allow" || v === "allow_once") return "allow";
  return "deny";
}
