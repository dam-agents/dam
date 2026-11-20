import { randomUUID } from "node:crypto";
import { MCP_TOOL_CALL_ARGUMENTS_MAX_BYTES } from "api-server-api";
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
import { waitForVerdict } from "./held-verdict.js";
import type {
  AgentIdentityResolver,
  EgressAttendance,
} from "./ext-authz-gate.js";
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

const MAX_LOGGED_NAME = 100;

// UNIT_BOUNDARY_DESCRIPTION: the hold of one `tools/call` of an MCP Connection in needs approval, as a tool-call approval. The same call sent again while one waits (same Connection, tool and arguments, told by the payload's key) joins that approval and waits only until its hold window ends; any other call, or one sent after that window, files its own. A channel turn nobody attends cannot get an answer, so the call is refused at once and the approval stays for the owner. Otherwise the in-session prompt goes to attached clients and the request waits up to the hold window: approve once sends it, and deny once or the end of the window answers it with a JSON-RPC error. A sub-agent with network access of its own cannot ask the owner, so its call is refused without an approval. An approve once outlives the client's own tool timeout until the hold window ends: a client that gives up closes its request, which stops the wait and leaves the approval pending, and the same call sent again after approve once is made, once. Each approve once makes exactly one call: the request that makes it uses the approval up first, so a held request that a retry beat to it is refused. The security log names the Connection and the tool, never the arguments.
export function createToolCallHold(deps: {
  repo: Pick<
    ApprovalsRepository,
    | "findActivePendingMcpToolCall"
    | "consumeAllowOnce"
    | "insertPending"
    | "getPending"
    | "expirePending"
  >;
  bus: RedisBus;
  attendance: EgressAttendance;
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
            mode: connection.mode,
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
      const approved = await deps.repo.consumeAllowOnce({
        agentId: identity.agentId,
        key,
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
      const unattended =
        (await deps.attendance.hasOpenChannelTurn(attendee)) &&
        !(await deps.attendance.hasInteractiveSession(attendee));
      const existing = await deps.repo.findActivePendingMcpToolCall({
        agentId: identity.agentId,
        key,
      });
      const pendingId = existing?.id ?? randomUUID();
      const expiresAt =
        existing?.expiresAt ?? new Date(Date.now() + deps.holdSeconds * 1000);
      if (!existing) {
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
            ...(via ? { viaAgentId: via } : {}),
            ...(identity.environment
              ? { viaEnvironment: identity.environment }
              : {}),
            ...(identity.own ? { forAgentId: identity.own.parentAgentId } : {}),
          },
          expiresAt,
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
        log("warn", "egress.decision", {
          decision: "deny",
          reason: "unattended-channel-turn",
          correlationId: pendingId,
        });
        return refuse("unattended");
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
        detail: { joined: existing !== null },
      });

      const settled = await waitForVerdict(deps, pendingId, {
        signal,
        expiresAt,
      });
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
