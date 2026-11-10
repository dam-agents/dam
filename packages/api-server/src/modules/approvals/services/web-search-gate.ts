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
} from "../domain/web-search-request.js";
import {
  bodyNotReadRefusal,
  refusedWebSearch,
  unreadableBodyRefusal,
  type WebSearchRefusal,
  type WebSearchRefusalReason,
} from "../domain/web-search-refusal.js";
import { waitForVerdict } from "./held-verdict.js";
import type {
  AgentIdentityResolver,
  EgressAttendance,
} from "./ext-authz-gate.js";

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
  control: WebSearchControl;
  rules: WebSearchRules;
  sessions: ScheduledSessions;
  holdSeconds: number;
}

const PASS: WebSearchGateOutcome = { pass: true };

const decoder = new TextDecoder("utf-8", { fatal: true });

function decoded(bytes: Uint8Array): string | null {
  try {
    return decoder.decode(bytes);
  } catch {
    return null;
  }
}

function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

// UNIT_BOUNDARY_DESCRIPTION: the step of the ext_authz gate that holds web searches for an agent with web search control on. It reads the whole body of each model call and finds a Messages call that declares a native web search tool; the agent's web search rule answers it, a scheduled or channel run nobody attends refuses it, and otherwise it waits as a web search approval, which a retry of the same search joins. A refused search is answered as a failed search, so the agent keeps working. Every other call passes on to the gate's other checks.
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
      const text = body.partial ? null : decoded(body.bytes);
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

      const refuse = (
        reason: WebSearchRefusalReason,
      ): WebSearchGateOutcome => ({
        pass: false,
        response: refusedWebSearch({
          endpoint,
          stream: request.stream,
          model: request.model,
          query: request.query,
          reason,
        }),
      });
      const queryKnown = request.query !== null;
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
      const unattended =
        ((await deps.attendance.hasOpenChannelTurn(attendee)) &&
          !(await deps.attendance.hasInteractiveSession(attendee))) ||
        (input.sessionId
          ? await deps.sessions.isScheduled(input.agentId, input.sessionId)
          : false);

      const key =
        request.query !== null
          ? `query:${sha256(request.query)}`
          : `body:${sha256(body.bytes)}`;
      const existing = await deps.repo.findActivePendingWebSearch({
        agentId: identity.agentId,
        key,
      });
      const pendingId = existing?.id ?? randomUUID();
      if (!existing) {
        await deps.repo.insertPending({
          id: pendingId,
          type: "web_search",
          agentId: identity.agentId,
          ownerSub: identity.ownerSub,
          sessionId: null,
          payload: {
            kind: "web_search",
            query: request.query,
            key,
            ...(input.via ? { viaAgentId: input.via } : {}),
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

      if (unattended) {
        log("warn", input, {
          decision: "deny",
          reason: "unattended",
          correlationId: pendingId,
          detail: { basis: "unattended", queryKnown },
        });
        return refuse("unattended");
      }

      void deps.bus.publish(
        injectChannelOf(identity.agentId),
        buildWebSearchSynthFrame({
          approvalId: pendingId,
          query: request.query,
        }),
      );
      log("warn", input, {
        decision: "hold",
        correlationId: pendingId,
        detail: { joined: existing !== null, queryKnown },
      });

      const settled = await waitForVerdict(deps, pendingId);
      if (settled.reason === "hold-expired" && settled.flipped) {
        emit({
          type: EventType.ApprovalResolved,
          approvalId: pendingId,
          agentId: identity.agentId,
          ownerSub: identity.ownerSub,
          resolution: "expired",
        });
      }
      const expired = settled.reason === "hold-expired";
      log(settled.verdict === "deny" ? "warn" : "info", input, {
        decision: expired ? "expired" : settled.verdict,
        reason: settled.reason,
        correlationId: pendingId,
        detail: { basis: "hold", queryKnown },
      });
      if (settled.verdict === "allow") return PASS;
      return refuse(expired ? "expired" : "denied");
    },
  };
}
