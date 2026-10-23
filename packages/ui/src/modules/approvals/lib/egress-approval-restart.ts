import type { ApprovalView, PromotionRule } from "api-server-api";

import { useStore } from "../../../store.js";
import { confirmStagedGatewayRestart } from "../../egress-rules/gateway-restart.js";

export interface EgressApprovalRestart {
  confirmNarrow: (confirmLabel: string) => Promise<boolean>;
  confirmHost: (confirmLabel: string) => Promise<boolean>;
  permanentTooltip: string;
  denyForeverTooltip: string;
  allowHostTooltip: string;
}

export function useEgressApprovalRestart(
  row: ApprovalView,
): EgressApprovalRestart {
  const showConfirm = useStore((s) => s.showConfirm);

  const payload = row.payload.kind === "ext_authz" ? row.payload : null;
  const narrowRule: PromotionRule | null = payload
    ? {
        host: payload.host,
        method: payload.method,
        pathPattern: payload.path,
        source: "inbox",
      }
    : null;
  const hostRule: PromotionRule | null = payload
    ? { host: payload.host, method: "*", pathPattern: "*", source: "inbox" }
    : null;

  const confirmFor = (rule: PromotionRule | null, confirmLabel: string) =>
    rule
      ? confirmStagedGatewayRestart(
          showConfirm,
          row.agentId,
          { adds: [rule] },
          confirmLabel,
        )
      : Promise.resolve(true);

  const inspectionNote = payload
    ? ` Needs request inspection for ${payload.host}, which restarts the network gateway unless it is already inspected.`
    : "";

  return {
    confirmNarrow: (confirmLabel) => confirmFor(narrowRule, confirmLabel),
    confirmHost: (confirmLabel) => confirmFor(hostRule, confirmLabel),
    permanentTooltip: `Allow this exact path on this host (writes a rule).${inspectionNote}`,
    denyForeverTooltip: `Deny this exact path on this host (writes a deny rule).${inspectionNote}`,
    allowHostTooltip: payload
      ? `Allow all requests to ${payload.host} (writes a wildcard rule). Never restarts the network gateway.`
      : "Allow all requests to this host (writes a wildcard rule).",
  };
}
