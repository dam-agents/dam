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
import { emit, EventType } from "../../../events.js";

export type ExtAuthzVerdict = "allow" | "deny";

export interface ExtAuthzGateInput {
  agentId: string;
  host: string;
  method: string;
  path: string;
}

export interface ExtAuthzGate {
  gateRequest(input: ExtAuthzGateInput): Promise<ExtAuthzVerdict>;
}

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
  holdSeconds: number;
  platformAllowedHosts: readonly string[];
}

export function createExtAuthzGate(deps: CreateExtAuthzGateDeps): ExtAuthzGate {
  return {
    async gateRequest({ agentId, host, method, path }) {
      const identity = await deps.identityResolver.resolve(agentId);
      if (!identity) {
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

      const unattended =
        (await deps.attendance.hasOpenChannelTurn(identity.agentId)) &&
        !(await deps.attendance.hasInteractiveSession(identity.agentId));

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
          payload: { kind: "ext_authz", host, method, path, viaAgentId: via },
          expiresAt: new Date(Date.now() + deps.holdSeconds * 1000),
        });
        emit({
          type: EventType.ApprovalRequested,
          approvalId: pendingId,
          agentId: identity.agentId,
          ownerSub: identity.ownerSub,
        });
        if (!unattended) {
          const frame = buildExtAuthzSynthFrame({
            approvalId: pendingId,
            host,
            method,
            path,
          });
          void deps.bus.publish(injectChannelOf(identity.agentId), frame);
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
      }

      if (unattended) {
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
      if (reason === "hold-expired") {
        emit({
          type: EventType.ApprovalResolved,
          approvalId: pendingId,
          agentId: identity.agentId,
          ownerSub: identity.ownerSub,
        });
      }
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
  return new Promise<SettledVerdict>((resolve) => {
    let settled = false;
    const settle = (s: SettledVerdict) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(s);
    };

    const checkResolved = async () => {
      const row = await deps.repo.getPending(id);
      if (!row || row.status !== "resolved") return;
      settle({ verdict: verdictOf(row.verdict), reason: "hold-resolved" });
    };

    const unsubscribe = deps.bus.subscribe(
      `approval:${id}`,
      () => void checkResolved(),
    );
    void checkResolved();

    const poll = setInterval(() => void checkResolved(), 15_000);
    poll.unref();

    const timeout = setTimeout(async () => {
      await deps.repo.expirePending(id).catch((err) => {
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
      clearInterval(poll);
      clearTimeout(timeout);
    }
  });
}

function verdictOf(v: string | null): ExtAuthzVerdict {
  if (v === "allow" || v === "allow_once") return "allow";
  return "deny";
}
