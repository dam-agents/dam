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
  /** Resolves the caller to the identity whose egress policy applies. For an
   *  Invocation target this is its driver (Egress Aliasing, recursively to
   *  the root non-target agent). Null when no policy-bearing agent exists —
   *  the gate fails closed. */
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

/** Whether anyone is positioned to answer a hold on this agent. Both facts are
 *  cross-replica reads and must fail toward "attended" so an infrastructure
 *  blip degrades to the ordinary hold — see `core/turn-attendance.ts`. */
export interface EgressAttendance {
  hasOpenChannelTurn(agentId: string): Promise<boolean>;
  hasInteractiveSession(agentId: string): Promise<boolean>;
}

export interface CreateExtAuthzGateDeps {
  repo: ApprovalsRepository;
  bus: RedisBus;
  identityResolver: AgentIdentityResolver;
  ruleMatcher: EgressRuleMatcher;
  attendance: EgressAttendance;
  /** Bounded synchronous hold; the durable pending row outlives this. */
  holdSeconds: number;
  /** Bare hostnames of platform-provided upstreams (the object store) that
   *  carry their own per-request authorization — no HITL hold. Checked after
   *  identity, before user rules. */
  platformAllowedHosts: readonly string[];
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

      // Egress Aliasing: when the caller is an Invocation target, `identity`
      // is its driver — every decision, hold, and rule below runs against the
      // driver. `via` keeps the originating caller auditable; undefined (the
      // caller is the policy-bearing agent itself) drops out of JSON.
      const via = identity.agentId !== agentId ? agentId : undefined;

      if (deps.platformAllowedHosts.includes(host)) {
        securityLog("info", "egress.decision", {
          category: "egress",
          actor: identity.ownerSub,
          actorKind: "agent",
          surface: "ext-authz",
          agentId: identity.agentId,
          target: host,
          decision: "allow",
          // Query stripped: presigned-link signatures ride there (mirrors
          // the gateway access log's REQ_WITHOUT_QUERY).
          detail: { method, path: path.split("?")[0], basis: "platform", via },
        });
        return "allow";
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
            detail: { method, path, basis: "rule", via },
          },
        );
        return matched.verdict;
      }

      // Holding is only worth anything if a human can answer it. A turn driven
      // from Slack or Telegram can't produce a verdict — the messenger offers
      // the owner no safe way to decide, and the conversation's other members
      // aren't the owner — so such a turn would stall for the whole window and
      // be denied anyway. Refuse it now instead, and leave the row below for
      // the inbox: a permanent approval there is what the agent's next attempt
      // consumes. An attached browser or CLI session means someone *can*
      // decide, so the hold stands even while a channel turn runs alongside.
      const unattended =
        (await deps.attendance.hasOpenChannelTurn(identity.agentId)) &&
        !(await deps.attendance.hasInteractiveSession(identity.agentId));

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
        // Recorded pending, not expired, on both paths: the row is what the
        // owner acts on later, and keeping it active is also what makes the
        // agent's retries reuse one inbox entry instead of filing a new one
        // each time.
        await deps.repo.insertPending({
          id: pendingId,
          type: "ext_authz",
          agentId: identity.agentId,
          ownerSub: identity.ownerSub,
          sessionId: null,
          payload: { kind: "ext_authz", host, method, path, viaAgentId: via },
          expiresAt: new Date(Date.now() + deps.holdSeconds * 1000),
        });
        if (!unattended) {
          const frame = buildExtAuthzSynthFrame({
            approvalId: pendingId,
            host,
            method,
            path,
          });
          // The prompt surfaces on the policy-bearing agent's channel — under
          // aliasing that is the driver, whose inbox tray owns the decision.
          void deps.bus.publish(injectChannelOf(identity.agentId), frame);
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
            detail: { method, path, via },
          });
        }
        // Unattended: no in-session prompt is published. The only subscribers
        // are the relay clients whose absence defines this path, and an
        // unconsumed frame would leave the inbox row looking answerable
        // in-session when the request has already been refused.
      }

      if (unattended) {
        // correlationId points at the row an owner can still approve, which is
        // what makes this deny distinguishable from a rule-based one.
        securityLog("warn", "egress.decision", {
          category: "egress",
          actor: identity.ownerSub,
          actorKind: "agent",
          surface: "ext-authz",
          agentId: identity.agentId,
          target: host,
          decision: "deny",
          correlationId: pendingId,
          reason: "unattended-channel-turn",
          detail: { method, path, basis: "unattended", via },
        });
        return "deny";
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
        detail: { method, path, basis: "hold", via },
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
