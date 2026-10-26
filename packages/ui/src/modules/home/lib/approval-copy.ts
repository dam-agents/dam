import {
  type ApprovalView,
  MICROS_PER_UNIT,
  type SpendLimitPayload,
  type SpendLimitScope,
  type SpendUnit,
} from "api-server-api";

export function approvalHeadline(approval: ApprovalView): string {
  if (approval.payload.kind === "ext_authz") return "Wants to access network";
  if (approval.payload.kind === "spend_limit") return "Hit a spend limit";
  return "Wants to run a command";
}

export function approvalDetail(approval: ApprovalView): string {
  const payload = approval.payload;
  if (payload.kind === "ext_authz")
    return `${payload.method} ${payload.host}${payload.path}`;
  if (payload.kind === "spend_limit") return spendLimitDetail(payload);
  return payload.toolName;
}

export function spendLimitAmount(micros: number, unit: SpendUnit): string {
  const value = (micros / MICROS_PER_UNIT).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: unit === "bobcoin" ? 6 : 2,
  });
  return unit === "bobcoin" ? `${value} Bobcoins` : `$${value}`;
}

export function spendLimitScopeLabel(scope: SpendLimitScope): string {
  switch (scope.kind) {
    case "owner":
      return "Your limit for all agents";
    case "agent":
      return "This agent's limit";
    case "connection":
      return "This agent's provider limit";
    case "owner-connection":
      return "Your provider limit";
  }
}

export function spendLimitDetail(payload: SpendLimitPayload): string {
  return `${spendLimitScopeLabel(payload.scope)} reached ${spendLimitAmount(payload.amountMicros, payload.unit)} today`;
}
