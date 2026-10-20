import { TOOL_CALL_ID_MAX } from "api-server-api";
import type {
  AcpPermissionOption,
  AcpPermissionOptionKind,
  ApprovalVerdict,
} from "api-server-api";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The frames a verdict becomes when it travels to
 * the runtime, and the verdict a reported outcome becomes when it travels
 * back. A verdict only ever answers in its own direction: a denial picks a
 * reject option or cancels, because the row's catalog is bounded and the
 * option it lost cannot be told apart from an allow, and an id a catalog
 * recorded twice — once as an allow, once as a shorter reject — is never sent
 * for a denial: the harness knows only one meaning for it. A catalog recorded
 * before ids were kept whole cannot prove its reject was not shortened, so a
 * reject at the old character bound is never sent from it either. In the other direction
 * the runtime holds the whole request, so the kind it reports states what an
 * option the row dropped was. That kind decides the verdict only when the
 * runtime reports it: the chat client's own answer travels unvalidated.
 */
export function pickOptionId(
  options: readonly AcpPermissionOption[],
  verdict: ApprovalVerdict,
  opts?: { idsWhole?: boolean },
): string | null {
  const want: AcpPermissionOptionKind =
    verdict === "deny"
      ? "reject_always"
      : verdict === "deny_once"
        ? "reject_once"
        : verdict === "allow"
          ? "allow_always"
          : "allow_once";
  const isAllow = verdict === "allow" || verdict === "allow_once";
  const allowIds = new Set(
    options
      .filter((o) => o.kind?.startsWith("allow") === true)
      .map((o) => o.optionId),
  );
  const answerable = options.filter(
    (o) =>
      isAllow ||
      (!allowIds.has(o.optionId) &&
        (opts?.idsWhole === true || o.optionId.length < TOOL_CALL_ID_MAX)),
  );
  const direct = answerable.find((o) => o.kind === want);
  if (direct) return direct.optionId;
  const fallback = answerable.find((o) => {
    if (!o.kind) return false;
    return isAllow ? o.kind.startsWith("allow") : o.kind.startsWith("reject");
  });
  if (fallback) return fallback.optionId;
  if (!isAllow) return null;
  const first = options[0];
  return first !== undefined && first.kind === undefined
    ? first.optionId
    : null;
}

export function verdictOfOutcome(
  options: readonly AcpPermissionOption[],
  outcome: { outcome?: unknown; optionId?: unknown; kind?: unknown },
  opts?: { reportedByRuntime?: boolean },
): ApprovalVerdict {
  if (outcome.outcome === "cancelled") return "deny_once";
  const recorded = options.find((o) => o.optionId === outcome.optionId)?.kind;
  const kind =
    (opts?.reportedByRuntime === true ? outcome.kind : undefined) ?? recorded;
  return kind === "allow_always"
    ? "allow"
    : kind === "reject_once"
      ? "deny_once"
      : kind === "reject_always"
        ? "deny"
        : "allow_once";
}

interface WrapperResponseFrame {
  jsonrpc: "2.0";
  id: number | string;
  result: {
    outcome:
      { outcome: "selected"; optionId: string } | { outcome: "cancelled" };
  };
}

export function buildAcpPermissionResponse(
  rpcId: number | string,
  optionId: string | null,
): WrapperResponseFrame {
  return {
    jsonrpc: "2.0",
    id: rpcId,
    result: optionId
      ? { outcome: { outcome: "selected", optionId } }
      : { outcome: { outcome: "cancelled" } },
  };
}
