import { randomUUID } from "node:crypto";
import { match } from "ts-pattern";
import type { ApprovalsRepository } from "../infrastructure/approvals-repository.js";
import type { RedisBus } from "../../../core/redis-bus.js";
import {
  buildExtAuthzSynthFrame,
  injectChannelOf,
} from "../infrastructure/acp-frames.js";
import { securityLog } from "../../../core/security-log.js";
import { emit, EventType } from "../../../events.js";
import { hasDotSegment } from "../domain/dot-segment.js";
import { canonicalEgressHost, PLATFORM_REFUSAL_HEADER } from "api-server-api";
import type { SpendCheck } from "../../spend/index.js";
import type { SpendLimitQuestions } from "./spend-limit-questions.js";
import { type SettledVerdict, waitForVerdict } from "./held-verdict.js";
import type { ModelCallBody, WebSearchGate } from "./web-search-gate.js";

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
      readonly basis: "spend" | "rule" | "web-search";
      readonly response: DeniedResponse;
    };

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
  /* UNIT_BOUNDARY_DESCRIPTION: set when the request came over a model-provider chain, whose spend meter marks every request, billable or not, so a path spelled to look unbillable is still read for web search. `sessionId` is the Model Router's stamp when the meter kept it. */
  modelCall?: { sessionId: string | null };
  body?: ModelCallBody;
}

export interface ExtAuthzGate {
  gateRequest(input: ExtAuthzGateInput): Promise<ExtAuthzDecision>;
}

// UNIT_BOUNDARY_DESCRIPTION: whose rules and approvals a request falls under: the agent itself, the driver of an invocation sub-agent, or the Owning Agent of an Environment, which `environment` then names so the approval says where the request came from; or a child whose egress is its own (`own`), whose open rules deny what they do not allow, and whose scoped rules are widened only by the user, on its parent.
export interface AgentIdentityResolver {
  resolve(agentId: string): Promise<{
    ownerSub: string;
    agentId: string;
    environment?: string;
    own?: { mode: "open" | "scoped"; parentAgentId: string };
  } | null>;
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

// UNIT_BOUNDARY_DESCRIPTION: whether a rule a child's driver asked for, which waits for the owner, would speak for a request once written, read as the gate's own lookup reads a stored rule.
export type WaitingRuleSpeaksFor = (
  rule: { host: string; port?: number; method: string; pathPattern: string },
  request: {
    host: string;
    port: number;
    tls: boolean;
    method: string;
    path: string;
  },
) => boolean;

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
  webSearch?: WebSearchGate;
  holdSeconds: number;
  platformAllowedAuthorities: readonly string[];
  waitingRuleSpeaksFor: WaitingRuleSpeaksFor;
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
      modelCall,
      body,
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

      if (modelCall && deps.webSearch) {
        const searched = await deps.webSearch.check({
          agentId,
          identity,
          via,
          host,
          path,
          body,
          sessionId: modelCall.sessionId,
        });
        if (!searched.pass)
          return {
            verdict: "refuse",
            basis: "web-search",
            response: searched.response,
          };
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

      if (identity.own?.mode === "open") {
        const waiting = (
          await deps.repo.listPendingChildEgressRequests(identity.agentId)
        ).find(
          (row) =>
            row.payload.kind === "egress_proposal" &&
            deps.waitingRuleSpeaksFor(
              {
                host: row.payload.host,
                ...(row.payload.port !== undefined
                  ? { port: row.payload.port }
                  : {}),
                method: row.payload.method,
                pathPattern: row.payload.path,
              },
              { host, port, tls, method, path },
            ),
        );
        if (waiting) {
          securityLog("warn", "egress.hold", {
            category: "egress",
            actor: identity.ownerSub,
            actorKind: "agent",
            surface: "ext-authz",
            agentId: identity.agentId,
            target: host,
            decision: "hold",
            correlationId: waiting.id,
            detail: { method, path, via, basis: "child-rule-waiting" },
          });
          const settled = await waitForVerdict(deps, waiting.id, {
            ownsRequest: false,
          });
          securityLog(
            settled.verdict === "deny" ? "warn" : "info",
            "egress.decision",
            {
              category: "egress",
              actor: identity.ownerSub,
              actorKind: "agent",
              surface: "ext-authz",
              agentId: identity.agentId,
              target: host,
              decision:
                settled.reason === "hold-expired" ? "expired" : settled.verdict,
              correlationId: waiting.id,
              reason: settled.reason,
              detail: { method, path, basis: "child-rule-waiting", via },
            },
          );
          return settled.verdict === "allow"
            ? "allow"
            : {
                verdict: "refuse",
                basis: "rule",
                response: waitingRefusal(host, settled.reason),
              };
        }
        securityLog("warn", "egress.decision", {
          category: "egress",
          actor: identity.ownerSub,
          actorKind: "agent",
          surface: "ext-authz",
          agentId: identity.agentId,
          target: host,
          decision: "deny",
          reason: "open-child-unlisted",
          detail: { method, path, via },
        });
        return "deny";
      }

      const attendee = identity.own?.parentAgentId ?? identity.agentId;
      const unattended =
        (await deps.attendance.hasOpenChannelTurn(attendee)) &&
        !(await deps.attendance.hasInteractiveSession(attendee));

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
            ...(identity.environment
              ? { viaEnvironment: identity.environment }
              : {}),
            ...(identity.own ? { forAgentId: identity.own.parentAgentId } : {}),
          },
          expiresAt: new Date(Date.now() + deps.holdSeconds * 1000),
        });
        emit({
          type: EventType.ApprovalRequested,
          approvalId: pendingId,
          agentId: identity.agentId,
          ownerSub: identity.ownerSub,
          ...(identity.own ? { forAgentId: identity.own.parentAgentId } : {}),
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

function waitingRefusal(
  host: string,
  reason: SettledVerdict["reason"],
): DeniedResponse {
  const why = match(reason)
    .with(
      "hold-resolved",
      () => "the agent's owner declined the network rule that would allow it",
    )
    .with(
      "hold-withdrawn",
      () =>
        "the network rule that would allow it is no longer asked of the agent's owner",
    )
    .with(
      "hold-expired",
      () =>
        "the network rule that would allow it still waits for the owner's approval, and the owner did not answer in time",
    )
    .exhaustive();
  return {
    status: 403,
    headers: {
      "content-type": "text/plain",
      [PLATFORM_REFUSAL_HEADER]: "egress",
    },
    body: `Blocked by the egress gateway, not the upstream: this request to ${host} was not allowed because ${why}. The agent that launched this one set the rule; its owner approves it on Home.`,
  };
}
