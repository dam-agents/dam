import { TOOL_CALL_ID_MAX } from "api-server-api";
import type {
  AcpPermissionOption,
  AcpPermissionOptionKind,
  ApprovalVerdict,
} from "api-server-api";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The frames a verdict becomes when it travels to
 * the runtime, and the verdict a reported outcome becomes when it travels
 * back. A verdict only ever answers in its own direction: the option it sends
 * must be the kind it asks for, because a catalog that recorded an id twice
 * cannot say what the harness will read. A catalog recorded before option ids
 * were kept whole is not trusted at all: its ids below the old character bound
 * were provably left alone, and an id at that bound may be a shortened one, so
 * a legacy row answers only a provably intact option of exactly the wanted
 * kind and cancels otherwise. Every catalog is answered that way, because a
 * whole id says which option it is, not how far the permission it grants
 * reaches: a one-time verdict never becomes the persistent kind, and an option
 * that states no kind is never sent, because nothing proves what it grants.
 * Every harness the platform ships states a kind on every option.
 * In the other direction the runtime holds the whole request, so the kind it
 * reports states what an option the row dropped was. That kind decides the
 * verdict only when the runtime reports it: the chat client's own answer
 * travels unvalidated.
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
  return (
    options.find(
      (o) =>
        o.kind === want &&
        (opts?.idsWhole === true || o.optionId.length < TOOL_CALL_ID_MAX),
    )?.optionId ?? null
  );
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
