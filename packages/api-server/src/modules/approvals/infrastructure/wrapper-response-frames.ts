import type {
  AcpPermissionOption,
  AcpPermissionOptionKind,
  ApprovalVerdict,
} from "api-server-api";

export function pickOptionId(
  options: readonly AcpPermissionOption[],
  verdict: ApprovalVerdict,
): string | null {
  const want: AcpPermissionOptionKind =
    verdict === "deny"
      ? "reject_always"
      : verdict === "deny_once"
        ? "reject_once"
        : verdict === "allow"
          ? "allow_always"
          : "allow_once";
  const direct = options.find((o) => o.kind === want);
  if (direct) return direct.optionId;
  const isAllow = verdict === "allow" || verdict === "allow_once";
  const fallback = options.find((o) => {
    if (!o.kind) return false;
    return isAllow ? o.kind.startsWith("allow") : o.kind.startsWith("reject");
  });
  if (fallback) return fallback.optionId;
  return options[0]?.optionId ?? null;
}

export function verdictOfOutcome(
  options: readonly AcpPermissionOption[],
  outcome: { outcome?: unknown; optionId?: unknown },
): ApprovalVerdict {
  if (outcome.outcome === "cancelled") return "deny_once";
  const kind = options.find((o) => o.optionId === outcome.optionId)?.kind;
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
