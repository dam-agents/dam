import { randomUUID } from "node:crypto";
import {
  MCP_TOOL_CALL_ARGUMENTS_MAX_BYTES,
  MCP_TOOL_CALL_TARGET_LABEL_MAX,
} from "api-server-api";
import type { ApprovalsRepository } from "../infrastructure/approvals-repository.js";
import type { RedisBus } from "../../../core/redis-bus.js";
import {
  buildMcpToolCallSynthFrame,
  injectChannelOf,
} from "../infrastructure/acp-frames.js";
import { securityLog } from "../../../core/security-log.js";
import { emit, EventType } from "../../../events.js";
import {
  shownToolCallArguments,
  toolCallKey,
} from "../domain/mcp-tool-calls.js";
import {
  heldToolCallRefusal,
  type HeldToolCallEnd,
  type ToolAccessRefusal,
} from "../domain/tool-access-refusal.js";
import { type HoldWaiters, waitForVerdict } from "./held-verdict.js";
import type { AgentIdentityResolver } from "./ext-authz-gate.js";
import {
  type EgressAttendance,
  type OwnerCardReach,
  routeHold,
} from "./hold-route.js";
import type { HeldToolCall } from "./tool-access-gate.js";

type EgressIdentity = NonNullable<
  Awaited<ReturnType<AgentIdentityResolver["resolve"]>>
>;

export interface ToolCallHoldInput {
  identity: EgressIdentity;
  via: string | undefined;
  method: string;
  path: string;
  toolCall: HeldToolCall;
  signal: AbortSignal | undefined;
}

export type ToolCallHoldOutcome =
  | { readonly kind: "allow" }
  | { readonly kind: "refuse"; readonly response: ToolAccessRefusal }
  | { readonly kind: "abandoned" };

export interface ToolCallHold {
  hold(input: ToolCallHoldInput): Promise<ToolCallHoldOutcome>;
}

// UNIT_BOUNDARY_DESCRIPTION: a name for the target of a held tool call, which the Connection's Template looks up with the Connection's own credential, such as the Slack conversation a post goes to. Null when the Template labels no target of this call or the lookup failed. The lookup stops when `signal` aborts.
export interface ToolCallLabels {
  targetLabel(
    call: {
      connectionId: string;
      templateId: string;
      tool: string;
      arguments: unknown;
    },
    signal: AbortSignal,
  ): Promise<string | null>;
}

const MAX_LOGGED_NAME = 100;

const TARGET_LABEL_WAIT_MS = 2_000;

async function targetLabelOf(
  labels: ToolCallLabels,
  toolCall: HeldToolCall,
): Promise<{ targetLabel?: string }> {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      abort.abort();
      resolve(null);
    }, TARGET_LABEL_WAIT_MS);
  });
  const looked = labels
    .targetLabel(
      {
        connectionId: toolCall.connection.connectionId,
        templateId: toolCall.connection.templateId,
        tool: toolCall.tool,
        arguments: toolCall.arguments,
      },
      abort.signal,
    )
    .catch(() => null);
  try {
    const label = (await Promise.race([looked, late]))?.trim();
    return label
      ? {
          targetLabel: [...label]
            .slice(0, MCP_TOOL_CALL_TARGET_LABEL_MAX)
            .join(""),
        }
      : {};
  } finally {
    clearTimeout(timer);
  }
}

// UNIT_BOUNDARY_DESCRIPTION: the hold of one `tools/call` of an MCP Connection in needs approval, as a tool-call approval. The same call sent again while one waits (same Connection, tool and arguments, told by the payload's key) joins that approval and waits only until its hold window ends; any other call, or one sent after that window, files its own. The shared hold decision refuses the call at once where nobody can answer it (a channel turn nobody attends, or a Slack turn whose person chose not to wait) and the approval stays for the owner. Otherwise the in-session prompt goes to attached clients and the request waits up to the approval's expiry, which a request of an addressed Slack turn that joins it moves to a full hold window: approve once sends it, and deny once or the end of the window answers it with a JSON-RPC error. A sub-agent with network access of its own cannot ask the owner, so its call is refused without an approval. An approve once outlives the client's own tool timeout for a hold window after it was given: a client that gives up closes its request, which stops the wait and leaves the approval pending, and the same call sent again after approve once is made, once. Each approve once makes exactly one call: the request that makes it uses the approval up first, so a held request that a retry beat to it is refused. A new approval also gets a name for the call's target when the Template can look one up within two seconds; a lookup that fails or is slow files the approval without one, and a call that joins reuses the approval as it is. The security log names the Connection and the tool, never the arguments or the target's name.
export function createToolCallHold(deps: {
  repo: Pick<
    ApprovalsRepository,
    | "findActivePendingMcpToolCall"
    | "consumeAllowOnce"
    | "insertPending"
    | "getPending"
    | "expirePending"
    | "raiseRoute"
  >;
  bus: RedisBus;
  attendance: EgressAttendance;
  cardReach: OwnerCardReach;
  waiters?: HoldWaiters;
  toolCallLabels: ToolCallLabels;
  holdSeconds: number;
}): ToolCallHold {
  return {
    async hold({ identity, via, method, path, toolCall, signal }) {
      const { connection, tool } = toolCall;
      const log = (
        level: "info" | "warn",
        event: "egress.hold" | "egress.decision",
        fields: {
          decision: "allow" | "deny" | "hold" | "expired";
          reason?: string;
          correlationId?: string;
          detail?: Record<string, unknown>;
        },
      ) =>
        securityLog(level, event, {
          category: "egress",
          actor: identity.ownerSub,
          actorKind: "agent",
          surface: "ext-authz",
          agentId: identity.agentId,
          target: toolCall.host,
          decision: fields.decision,
          ...(fields.reason ? { reason: fields.reason } : {}),
          ...(fields.correlationId
            ? { correlationId: fields.correlationId }
            : {}),
          detail: {
            method,
            path: path.split("?")[0],
            basis: "tool-approval",
            connectionId: connection.connectionId,
            tool: tool.slice(0, MAX_LOGGED_NAME),
            via,
            ...fields.detail,
          },
        });
      const refuse = (end: HeldToolCallEnd): ToolCallHoldOutcome => ({
        kind: "refuse",
        response: heldToolCallRefusal(
          {
            host: toolCall.host,
            connectionName: connection.connectionName,
          },
          { tool, id: toolCall.id },
          end,
          deps.holdSeconds,
        ),
      });

      if (identity.own?.mode === "open") {
        log("warn", "egress.decision", {
          decision: "deny",
          reason: "open-child-unlisted",
        });
        return refuse("child");
      }

      const key = toolCallKey(
        connection.connectionId,
        tool,
        toolCall.arguments,
      );
      const holdMs = deps.holdSeconds * 1000;
      const approved = await deps.repo.consumeAllowOnce({
        agentId: identity.agentId,
        shape: { type: "mcp_tool_call", key },
        answeredSince: new Date(Date.now() - holdMs),
      });
      if (approved) {
        log("info", "egress.decision", {
          decision: "allow",
          reason: "allow-once-used",
          correlationId: approved,
        });
        return { kind: "allow" };
      }

      const attendee = identity.own?.parentAgentId ?? identity.agentId;
      const routed = await routeHold(deps, {
        attendee,
        ownerSub: identity.ownerSub,
      });
      const routeDetail = {
        route: routed.route,
        decidedBy: routed.basis,
        addressed: routed.addressedTurnOpen,
      };
      const existing = await deps.repo.findActivePendingMcpToolCall({
        agentId: identity.agentId,
        key,
      });
      const pendingId = existing?.id ?? randomUUID();
      let expiresAt = existing?.expiresAt ?? new Date(Date.now() + holdMs);
      if (!existing) {
        const label = await targetLabelOf(deps.toolCallLabels, toolCall);
        await deps.repo.insertPending({
          id: pendingId,
          type: "mcp_tool_call",
          agentId: identity.agentId,
          ownerSub: identity.ownerSub,
          sessionId: null,
          payload: {
            kind: "mcp_tool_call",
            connectionId: connection.connectionId,
            connectionName: connection.connectionName,
            templateId: connection.templateId,
            tool,
            key,
            ...shownToolCallArguments(
              toolCall.arguments,
              MCP_TOOL_CALL_ARGUMENTS_MAX_BYTES,
            ),
            ...label,
            ...(via ? { viaAgentId: via } : {}),
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
          log("info", "egress.hold", {
            decision: "hold",
            reason: "route-raised",
            correlationId: pendingId,
            detail: { expiresAt: raisedUntil.toISOString() },
          });
        }
      }

      if (routed.verdict === "refuse") {
        log("warn", "egress.decision", {
          decision: "deny",
          reason: routed.basis,
          correlationId: pendingId,
          detail: routeDetail,
        });
        return refuse(
          routed.basis === "released-turn" ? "released" : "unattended",
        );
      }

      void deps.bus.publish(
        injectChannelOf(identity.agentId),
        buildMcpToolCallSynthFrame({
          approvalId: pendingId,
          connectionId: connection.connectionId,
          connectionName: connection.connectionName,
          tool,
        }),
      );
      log("warn", "egress.hold", {
        decision: "hold",
        correlationId: pendingId,
        detail: { joined: existing !== null, ...routeDetail },
      });

      const settled = await waitForVerdict(deps, pendingId, {
        signal,
        expiresAt,
        ...(routed.route === "turn" ? { release: { agentId: attendee } } : {}),
        tracked: {
          agentId: identity.agentId,
          ownerSub: identity.ownerSub,
          route: routed.route,
        },
      });
      if (settled.reason === "hold-released") {
        log("warn", "egress.decision", {
          decision: "deny",
          reason: settled.reason,
          correlationId: pendingId,
          detail: routeDetail,
        });
        return refuse("released");
      }
      if (settled.reason === "hold-abandoned") {
        log("warn", "egress.decision", {
          decision: "deny",
          reason: settled.reason,
          correlationId: pendingId,
        });
        return { kind: "abandoned" };
      }
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
      const usedUp =
        settled.verdict === "allow" &&
        (await deps.repo.consumeAllowOnce({ id: pendingId })) === null;
      const verdict = usedUp ? "deny" : settled.verdict;
      log(verdict === "deny" ? "warn" : "info", "egress.decision", {
        decision: expired ? "expired" : verdict,
        reason: usedUp ? "allow-once-used-up" : settled.reason,
        correlationId: pendingId,
      });
      if (verdict === "allow") return { kind: "allow" };
      return refuse(expired ? "expired" : usedUp ? "used-up" : "denied");
    },
  };
}
