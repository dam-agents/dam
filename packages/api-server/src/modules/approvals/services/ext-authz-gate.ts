import { randomUUID } from "node:crypto";
import type { ApprovalsRepository } from "../infrastructure/approvals-repository.js";
import type { RedisBus } from "../../../core/redis-bus.js";
import {
  buildExtAuthzSynthFrame,
  injectChannelOf,
} from "../infrastructure/acp-frames.js";
import { securityLog } from "../../../core/security-log.js";
import { getLogger } from "../../../core/logger.js";
import { formatError } from "../../../core/format-error.js";

export type ExtAuthzVerdict = "allow" | "deny";

export interface ExtAuthzGateInput {
  agentId: string;
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
export interface AgentIdentityResolver {
  resolve(
    agentId: string,
  ): Promise<{ ownerSub: string; agentId: string } | null>;
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
  identityResolver: AgentIdentityResolver;
  ruleMatcher: EgressRuleMatcher;
  /** Bounded synchronous hold; the durable pending row outlives this. */
  holdSeconds: number;
}

export function createExtAuthzGate(deps: CreateExtAuthzGateDeps): ExtAuthzGate {
  return {
    async gateRequest({ agentId, host, method, path }) {
      const identity = await deps.identityResolver.resolve(agentId);
      if (!identity) {
        // A caller presenting an agent id that resolves to no owner is the
        // spoof / stale-caller signal an investigator wants — fail closed.
        securityLog("warn", "egress.decision", {
          category: "egress",
          actor: null,
          actorKind: "agent",
          surface: "ext-authz",
          agentId,
          target: host,
          decision: "deny",
          reason: "identity-unresolved",
          detail: { method, path },
        });
        return "deny";
      }

      const matched = await deps.ruleMatcher.match(
        identity.agentId,
        host,
        method,
        path,
      );
      if (matched) {
        securityLog(
          matched.verdict === "deny" ? "warn" : "info",
          "egress.decision",
          {
            category: "egress",
            actor: identity.ownerSub,
            actorKind: "agent",
            surface: "ext-authz",
            agentId: identity.agentId,
            target: host,
            decision: matched.verdict,
            detail: { method, path, basis: "rule" },
          },
        );
        return matched.verdict;
      }

      // Dedupe retried holds: when the agent's CLI retries (Envoy timeout,
      // network blip, api-server restart mid-hold) we want one inbox row
      // per logical decision, not one per retry. Reuse any active pending
      // row of the same shape; otherwise insert fresh. The synth frame is
      // only republished on first insert — replicas already subscribed
      // pick up the original; new tabs query the inbox via tRPC.
      const existing = await deps.repo.findActivePendingExtAuthz({
        agentId: identity.agentId,
        host,
        method,
        path,
      });
      const pendingId = existing?.id ?? randomUUID();
      if (!existing) {
        await deps.repo.insertPending({
          id: pendingId,
          type: "ext_authz",
          agentId: identity.agentId,
          ownerSub: identity.ownerSub,
          sessionId: null,
          payload: { kind: "ext_authz", host, method, path },
          expiresAt: new Date(Date.now() + deps.holdSeconds * 1000),
        });
        const frame = buildExtAuthzSynthFrame({
          approvalId: pendingId,
          host,
          method,
          path,
        });
        void deps.bus.publish(injectChannelOf(agentId), frame);
        // Agent egress blocked awaiting a human verdict. correlationId ties
        // this to the verdict line written when the hold settles (and to the
        // approval.verdict line in approvals-service).
        securityLog("warn", "egress.hold", {
          category: "egress",
          actor: identity.ownerSub,
          actorKind: "agent",
          surface: "ext-authz",
          agentId: identity.agentId,
          target: host,
          decision: "hold",
          correlationId: pendingId,
          detail: { method, path },
        });
      }

      const { verdict, reason } = await waitForVerdict(deps, pendingId);
      securityLog(verdict === "deny" ? "warn" : "info", "egress.decision", {
        category: "egress",
        actor: identity.ownerSub,
        actorKind: "agent",
        surface: "ext-authz",
        agentId: identity.agentId,
        target: host,
        decision: reason === "hold-expired" ? "expired" : verdict,
        correlationId: pendingId,
        reason,
        detail: { method, path, basis: "hold" },
      });
      return verdict;
    },
  };
}

interface SettledVerdict {
  verdict: ExtAuthzVerdict;
  reason: "hold-resolved" | "hold-expired";
}

async function waitForVerdict(
  deps: CreateExtAuthzGateDeps,
  id: string,
): Promise<SettledVerdict> {
  // Re-read the row up front: a verdict written between INSERT and
  // SUBSCRIBE would otherwise be missed. Postgres is the truth path.
  const initial = await deps.repo.getPending(id);
  if (initial && initial.status === "resolved")
    return { verdict: verdictOf(initial.verdict), reason: "hold-resolved" };

  return new Promise<SettledVerdict>((resolve) => {
    let settled = false;
    const settle = (s: SettledVerdict) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(s);
    };

    const unsubscribe = deps.bus.subscribe(`approval:${id}`, async () => {
      const row = await deps.repo.getPending(id);
      if (!row || row.status !== "resolved") return;
      settle({ verdict: verdictOf(row.verdict), reason: "hold-resolved" });
    });

    const timeout = setTimeout(async () => {
      // Mark expired so the inbox shows the row's terminal state. The
      // egress rules path is unaffected — a future approve-permanent still
      // writes a rule that the agent's next retry consumes.
      await deps.repo.expirePending(id).catch((err) => {
        // Surface rather than swallow: a failure here means the inbox row is
        // stuck non-terminal even though the hold fail-closed denied.
        getLogger().error(
          { pendingId: id, reason: formatError(err) },
          "egress.hold_expire_error",
        );
      });
      settle({ verdict: "deny", reason: "hold-expired" });
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
