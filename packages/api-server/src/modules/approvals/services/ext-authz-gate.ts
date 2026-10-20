import { randomUUID } from "node:crypto";
import { match } from "ts-pattern";
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
import { hasDotSegment } from "../domain/dot-segment.js";
import { canonicalEgressHost, PLATFORM_REFUSAL_HEADER } from "api-server-api";
import type { SpendCheck } from "../../spend/index.js";
import type { SpendLimitQuestions } from "./spend-limit-questions.js";

export type ExtAuthzVerdict = "allow" | "deny";

export interface DeniedResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export type ExtAuthzDecision =
  | ExtAuthzVerdict
  | {
      readonly verdict: "refuse";
      readonly basis: "spend" | "rule";
      readonly response: DeniedResponse;
    };

export const approvalChannelOf = (id: string) => `approval:${id}`;

type SpendCall = Omit<
  Parameters<SpendCheck["checkCall"]>[0],
  "agentId" | "ownerSub" | "startedAt"
>;

interface ExtAuthzGateInput {
  agentId: string;
  host: string;
  port: number;
  tls: boolean;
  method: string;
  path: string;
  spendCall?: SpendCall | null;
}

export interface ExtAuthzGate {
  gateRequest(input: ExtAuthzGateInput): Promise<ExtAuthzDecision>;
}

export interface AgentIdentityResolver {
  resolve(
    agentId: string,
  ): Promise<{ ownerSub: string; agentId: string } | null>;
}

export interface MatchedEgressRule {
  readonly host: string;
  readonly port?: number;
  readonly method: string;
  readonly pathPattern: string;
}

export interface EgressRuleMatcher {
  match(
    agentId: string,
    host: string,
    port: number,
    tls: boolean,
    method: string,
    path: string,
  ): Promise<{ verdict: ExtAuthzVerdict; rule: MatchedEgressRule } | null>;
}

export interface ProviderScopes {
  covers(
    agentId: string,
    request: { host: string; port: number; tls: boolean; path: string },
  ): Promise<boolean>;
}

export interface EgressAttendance {
  hasOpenChannelTurn(agentId: string): Promise<boolean>;
  hasInteractiveSession(agentId: string): Promise<boolean>;
}

interface CreateExtAuthzGateDeps {
  repo: ApprovalsRepository;
  bus: RedisBus;
  identityResolver: AgentIdentityResolver;
  ruleMatcher: EgressRuleMatcher;
  providerScopes: ProviderScopes;
  attendance: EgressAttendance;
  spend: Pick<SpendCheck, "checkCall">;
  questions: SpendLimitQuestions;
  holdSeconds: number;
  platformAllowedAuthorities: readonly string[];
}

export function createExtAuthzGate(deps: CreateExtAuthzGateDeps): ExtAuthzGate {
  return {
    async gateRequest({
      agentId,
      host: requestHost,
      port,
      tls,
      method,
      path,
      spendCall,
    }) {
      const host = canonicalEgressHost(requestHost);
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

      if (spendCall) {
        const spend = await deps.spend.checkCall({
          ...spendCall,
          agentId,
          ownerSub: identity.ownerSub,
          startedAt: new Date(),
        });
        if (spend.verdict === "refuse") {
          await deps.questions.ask({
            agentId: spendCall.payer,
            ownerSub: identity.ownerSub,
            questions: spend.questions,
          });
          securityLog("warn", "egress.decision", {
            category: "egress",
            actor: identity.ownerSub,
            actorKind: "agent",
            surface: "ext-authz",
            agentId: identity.agentId,
            target: host,
            decision: "deny",
            reason: match(spend.reason)
              .with("ceiling", () => "spend-ceiling")
              .with("limit", () => "spend-limit")
              .exhaustive(),
            detail: {
              method,
              path: path.split("?")[0],
              basis: "spend",
              status: spend.response.status,
              via,
            },
          });
          return {
            verdict: "refuse",
            basis: "spend",
            response: spend.response,
          };
        }
      }

      if (deps.platformAllowedAuthorities.includes(`${host}:${port}`)) {
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

      if (hasDotSegment(path)) {
        securityLog("warn", "egress.decision", {
          category: "egress",
          actor: identity.ownerSub,
          actorKind: "agent",
          surface: "ext-authz",
          agentId: identity.agentId,
          target: host,
          decision: "deny",
          reason: "dot-segment",
          detail: { method, path, via },
        });
        return "deny";
      }

      const matched = await deps.ruleMatcher.match(
        identity.agentId,
        host,
        port,
        tls,
        method,
        path,
      );
      if (
        matched?.verdict !== "allow" &&
        (await deps.providerScopes.covers(agentId, { host, port, tls, path }))
      ) {
        const overridden = matched?.verdict === "deny";
        securityLog(overridden ? "warn" : "info", "egress.decision", {
          category: "egress",
          actor: identity.ownerSub,
          actorKind: "agent",
          surface: "ext-authz",
          agentId: identity.agentId,
          target: host,
          decision: "allow",
          ...(overridden ? { reason: "provider-over-deny-rule" } : {}),
          detail: { method, path, basis: "provider", via },
        });
        return "allow";
      }
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
        return matched.verdict === "deny"
          ? {
              verdict: "refuse",
              basis: "rule",
              response: ruleRefusal(host, matched.rule),
            }
          : matched.verdict;
      }

      const unattended =
        (await deps.attendance.hasOpenChannelTurn(identity.agentId)) &&
        !(await deps.attendance.hasInteractiveSession(identity.agentId));

      const nonDefaultPort = port === (tls ? 443 : 80) ? undefined : port;
      const existing = await deps.repo.findActivePendingExtAuthz({
        agentId: identity.agentId,
        host,
        port: nonDefaultPort,
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
          payload: {
            kind: "ext_authz",
            host,
            ...(nonDefaultPort ? { port: nonDefaultPort } : {}),
            method,
            path,
            viaAgentId: via,
          },
          expiresAt: new Date(Date.now() + deps.holdSeconds * 1000),
        });
        emit({
          type: EventType.ApprovalRequested,
          approvalId: pendingId,
          agentId: identity.agentId,
          ownerSub: identity.ownerSub,
        });
      }

      if (!unattended) {
        const frame = buildExtAuthzSynthFrame({
          approvalId: pendingId,
          host,
          port: nonDefaultPort,
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
          detail: { method, path, via, joined: existing !== null },
        });
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

      const settledVerdict = await waitForVerdict(deps, pendingId);
      const { verdict, reason } = settledVerdict;
      if (settledVerdict.reason === "hold-expired" && settledVerdict.flipped) {
        emit({
          type: EventType.ApprovalResolved,
          approvalId: pendingId,
          agentId: identity.agentId,
          ownerSub: identity.ownerSub,
          resolution: "expired",
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

function ruleRefusal(host: string, rule: MatchedEgressRule): DeniedResponse {
  const ruleHost = rule.port ? `${rule.host}:${rule.port}` : rule.host;
  return {
    status: 403,
    headers: {
      "content-type": "text/plain",
      [PLATFORM_REFUSAL_HEADER]: "egress",
    },
    body: `Blocked by network rule "deny ${ruleHost}, method ${rule.method}, path ${rule.pathPattern}": the egress gateway refused this request to ${host}, not the upstream. The agent's owner can change the rule in the agent's network settings.`,
  };
}

type SettledVerdict =
  | { verdict: ExtAuthzVerdict; reason: "hold-resolved" }
  | { verdict: "deny"; reason: "hold-expired"; flipped: boolean };

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
      settle({
        verdict:
          row.verdict === "allow" || row.verdict === "allow_once"
            ? "allow"
            : "deny",
        reason: "hold-resolved",
      });
    };

    const unsubscribe = deps.bus.subscribe(
      approvalChannelOf(id),
      () => void checkResolved(),
    );
    void checkResolved();

    const poll = setInterval(() => void checkResolved(), 15_000);
    poll.unref();

    const timeout = setTimeout(async () => {
      const flipped = await deps.repo.expirePending(id).catch((err) => {
        getLogger().error(
          { pendingId: id, reason: formatError(err) },
          "egress.hold_expire_error",
        );
        return false;
      });
      settle({ verdict: "deny", reason: "hold-expired", flipped });
    }, deps.holdSeconds * 1000);
    timeout.unref();

    function cleanup() {
      unsubscribe();
      clearInterval(poll);
      clearTimeout(timeout);
    }
  });
}
