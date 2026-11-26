import { createHash, randomUUID } from "node:crypto";
import type { ApprovalsRepository } from "../infrastructure/approvals-repository.js";
import type { RedisBus } from "../../../core/redis-bus.js";
import {
  buildWebSearchSynthFrame,
  injectChannelOf,
} from "../infrastructure/acp-frames.js";
import { securityLog } from "../../../core/security-log.js";
import { emit, EventType } from "../../../events.js";
import {
  messagesEndpointOf,
  readWebSearchRequest,
  shownQuery,
} from "../domain/web-search-request.js";
import {
  bodyNotReadRefusal,
  refusedWebSearch,
  unreadableBodyRefusal,
  type WebSearchRefusal,
  type WebSearchRefusalReason,
} from "../domain/web-search-refusal.js";
import { decodedUtf8 } from "../domain/check-body.js";
import { type HoldWaiters, waitForVerdict } from "./held-verdict.js";
import type { AgentIdentityResolver } from "./ext-authz-gate.js";
import {
  type EgressAttendance,
  type OwnerCardReach,
  routeHold,
} from "./hold-route.js";

export interface WebSearchControl {
  isOn(agentId: string): Promise<boolean>;
}

export interface WebSearchRules {
  verdictOf(agentId: string): Promise<"allow" | "deny" | null>;
}

// UNIT_BOUNDARY_DESCRIPTION: whether the Session a model call names was started by a schedule. The name is the Model Router's stamp, written in the machine, so it can only move a search from a hold to a refusal, never let one through.
export interface ScheduledSessions {
  isScheduled(agentId: string, sessionId: string): Promise<boolean>;
}

// UNIT_BOUNDARY_DESCRIPTION: the body of a model call as the gateway handed it to the check. A gateway rendered with web search control sends the whole body; one that is not yet sends none, and `declared` then says whether the request has a body at all.
export type ModelCallBody =
  | { readonly sent: false; readonly declared: boolean }
  | {
      readonly sent: true;
      readonly partial: boolean;
      readonly bytes: Uint8Array;
    };

type EgressIdentity = NonNullable<
  Awaited<ReturnType<AgentIdentityResolver["resolve"]>>
>;

export interface WebSearchGateInput {
  agentId: string;
  identity: EgressIdentity;
  via: string | undefined;
  host: string;
  path: string;
  body: ModelCallBody | undefined;
  sessionId: string | null | undefined;
  signal?: AbortSignal;
}

export type WebSearchGateOutcome =
  | { readonly pass: true }
  | { readonly pass: false; readonly response: WebSearchRefusal };

export interface WebSearchGate {
  check(input: WebSearchGateInput): Promise<WebSearchGateOutcome>;
}

export interface CreateWebSearchGateDeps {
  repo: ApprovalsRepository;
  bus: RedisBus;
  attendance: EgressAttendance;
  cardReach: OwnerCardReach;
  waiters?: HoldWaiters;
  control: WebSearchControl;
  rules: WebSearchRules;
  sessions: ScheduledSessions;
  holdSeconds: number;
}

const PASS: WebSearchGateOutcome = { pass: true };

function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

// UNIT_BOUNDARY_DESCRIPTION: the step of the ext_authz gate that holds web searches for an agent with web search control on. It reads the whole body of each model call and finds a Messages call that declares a native web search tool; the agent's web search rule answers it; otherwise the shared hold decision refuses it at once (a channel turn nobody attends, a released Slack turn, or a scheduled run whose owner cannot get cards) or holds it as a web search approval, which a retry of the same search joins and an approve once given after its client left still lets through once. A refused search is answered as a failed search, so the agent keeps working. Every other call passes on to the gate's other checks.
export function createWebSearchGate(
  deps: CreateWebSearchGateDeps,
): WebSearchGate {
  function log(
    level: "info" | "warn",
    input: WebSearchGateInput,
    fields: {
      decision: "allow" | "deny" | "hold" | "expired";
      reason?: string;
      correlationId?: string;
      detail?: Record<string, unknown>;
    },
  ): void {
    securityLog(
      level,
      fields.decision === "hold" ? "web_search.hold" : "web_search.decision",
      {
        category: "egress",
        actor: input.identity.ownerSub,
        actorKind: "agent",
        surface: "ext-authz",
        agentId: input.identity.agentId,
        target: input.host,
        decision: fields.decision,
        ...(fields.reason ? { reason: fields.reason } : {}),
        ...(fields.correlationId
          ? { correlationId: fields.correlationId }
          : {}),
        detail: {
          path: input.path.split("?")[0],
          via: input.via,
          ...fields.detail,
        },
      },
    );
  }

  return {
    async check(input) {
      if (!(await deps.control.isOn(input.agentId))) return PASS;
      const body = input.body;
      if (!body || !body.sent) {
        if (!body?.declared) return PASS;
        log("warn", input, { decision: "deny", reason: "body-not-read" });
        return { pass: false, response: bodyNotReadRefusal() };
      }
      const endpoint = messagesEndpointOf(input.path);
      const text = body.partial ? null : decodedUtf8(body.bytes);
      const request =
        text === null
          ? { kind: "unreadable" as const }
          : readWebSearchRequest(text);
      if (request.kind === "none" || endpoint === "count") return PASS;
      if (request.kind === "unreadable") {
        if (endpoint === "none") return PASS;
        log("warn", input, { decision: "deny", reason: "unreadable-body" });
        return { pass: false, response: unreadableBodyRefusal() };
      }

      const query = shownQuery(request.query);
      const refuse = (
        reason: WebSearchRefusalReason,
      ): WebSearchGateOutcome => ({
        pass: false,
        response: refusedWebSearch({
          endpoint,
          stream: request.stream,
          model: request.model,
          query,
          reason,
        }),
      });
      const queryKnown = query !== null;
      const { identity } = input;

      const rule = await deps.rules.verdictOf(identity.agentId);
      if (rule !== null) {
        log(rule === "allow" ? "info" : "warn", input, {
          decision: rule,
          detail: { basis: "rule", queryKnown },
        });
        return rule === "allow" ? PASS : refuse("rule");
      }
      if (identity.own?.mode === "open") {
        log("warn", input, {
          decision: "deny",
          reason: "open-child-unlisted",
          detail: { queryKnown },
        });
        return refuse("child");
      }

      const attendee = identity.own?.parentAgentId ?? identity.agentId;
      const holdMs = deps.holdSeconds * 1000;
      const key =
        request.query !== null
          ? `query:${sha256(request.query)}`
          : `body:${sha256(body.bytes)}`;
      const usedOnce = await deps.repo.consumeAllowOnce({
        agentId: identity.agentId,
        shape: { type: "web_search", key },
        answeredSince: new Date(Date.now() - holdMs),
      });
      if (usedOnce) {
        log("info", input, {
          decision: "allow",
          reason: "allow-once-used",
          correlationId: usedOnce,
          detail: { basis: "hold", queryKnown },
        });
        return PASS;
      }

      const sessionId = input.sessionId;
      const routed = await routeHold(deps, {
        attendee,
        ownerSub: identity.ownerSub,
        ...(sessionId
          ? {
              scheduledWebSearch: () =>
                deps.sessions.isScheduled(input.agentId, sessionId),
            }
          : {}),
      });
      const routeDetail = {
        route: routed.route,
        decidedBy: routed.basis,
        addressed: routed.addressedTurnOpen,
      };

      const existing = await deps.repo.findActivePendingWebSearch({
        agentId: identity.agentId,
        key,
      });
      const pendingId = existing?.id ?? randomUUID();
      let expiresAt = existing?.expiresAt ?? new Date(Date.now() + holdMs);
      if (!existing) {
        await deps.repo.insertPending({
          id: pendingId,
          type: "web_search",
          agentId: identity.agentId,
          ownerSub: identity.ownerSub,
          sessionId: null,
          payload: {
            kind: "web_search",
            query,
            key,
            ...(input.via ? { viaAgentId: input.via } : {}),
            ...(identity.environment
              ? { viaEnvironment: identity.environment }
              : {}),
            ...(identity.own ? { forAgentId: identity.own.parentAgentId } : {}),
            ...(routed.refusedIn ? { refusedIn: routed.refusedIn } : {}),
          },
          expiresAt,
          ownerRoute: routed.route,
        });
        emit({
          type: EventType.ApprovalRequested,
          approvalId: pendingId,
          agentId: identity.agentId,
          ownerSub: identity.ownerSub,
          ...(identity.own ? { forAgentId: identity.own.parentAgentId } : {}),
          ownerRoute: routed.route,
        });
      } else if (routed.route === "turn" && existing.ownerRoute !== "turn") {
        const raisedUntil = new Date(Date.now() + holdMs);
        if (await deps.repo.raiseRoute(pendingId, raisedUntil)) {
          expiresAt = raisedUntil;
          emit({
            type: EventType.ApprovalRouteRaised,
            approvalId: pendingId,
            agentId: identity.agentId,
            ownerSub: identity.ownerSub,
          });
          log("info", input, {
            decision: "hold",
            reason: "route-raised",
            correlationId: pendingId,
            detail: { expiresAt: raisedUntil.toISOString(), queryKnown },
          });
        }
      }

      if (routed.verdict === "refuse") {
        log("warn", input, {
          decision: "deny",
          reason: routed.basis,
          correlationId: pendingId,
          detail: { basis: "unattended", queryKnown, ...routeDetail },
        });
        return refuse(
          routed.basis === "released-turn" ? "released" : "unattended",
        );
      }

      void deps.bus.publish(
        injectChannelOf(identity.agentId),
        buildWebSearchSynthFrame({
          approvalId: pendingId,
          query,
        }),
      );
      log("warn", input, {
        decision: "hold",
        correlationId: pendingId,
        detail: { joined: existing !== null, queryKnown, ...routeDetail },
      });

      const settled = await waitForVerdict(deps, pendingId, {
        signal: input.signal,
        expiresAt,
        ...(routed.route === "turn"
          ? { release: { agentId: attendee, sessionId: input.sessionId } }
          : {}),
        tracked: {
          agentId: identity.agentId,
          ownerSub: identity.ownerSub,
          route: routed.route,
        },
      });
      if (settled.reason === "hold-expired" && settled.flipped) {
        emit({
          type: EventType.ApprovalResolved,
          approvalId: pendingId,
          agentId: identity.agentId,
          ownerSub: identity.ownerSub,
          resolution: "expired",
          ownerRoute: routed.route,
        });
      }
      const expired = settled.reason === "hold-expired";
      log(settled.verdict === "deny" ? "warn" : "info", input, {
        decision: expired ? "expired" : settled.verdict,
        reason: settled.reason,
        correlationId: pendingId,
        detail: { basis: "hold", queryKnown, ...routeDetail },
      });
      if (settled.verdict === "allow") {
        await deps.repo.consumeAllowOnce({ id: pendingId }).catch(() => null);
        return PASS;
      }
      if (settled.reason === "hold-released") return refuse("released");
      return refuse(expired ? "expired" : "denied");
    },
  };
}
