import type {
  ApprovalView,
  EgressRuleView,
  PromotionRule,
} from "api-server-api";

import { useStore } from "../../../store.js";
import { useEgressRulesForAgent } from "../../egress-rules/api/queries.js";
import {
  describeGatewayRestart,
  GATEWAY_RESTART_TITLE,
  stagedGatewayRestart,
} from "../../egress-rules/gateway-restart.js";

const EMPTY: EgressRuleView[] = [];

export interface EgressApprovalRestart {
  narrowRestarts: boolean;
  hostRestarts: boolean;
  confirmNarrow: (confirmLabel: string) => Promise<boolean>;
  confirmHost: (confirmLabel: string) => Promise<boolean>;
  permanentTooltip: string;
  denyForeverTooltip: string;
  allowHostTooltip: string;
}

export function useEgressApprovalRestart(
  row: ApprovalView,
): EgressApprovalRestart {
  const { data: agentRules = EMPTY } = useEgressRulesForAgent(row.agentId);
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

  const narrow = narrowRule
    ? stagedGatewayRestart({ current: agentRules, adds: [narrowRule] })
    : null;
  const host = hostRule
    ? stagedGatewayRestart({ current: agentRules, adds: [hostRule] })
    : null;

  const confirmFor =
    (impact: ReturnType<typeof stagedGatewayRestart> | null) =>
    async (confirmLabel: string) => {
      if (!impact?.willRestart) return true;
      return showConfirm(
        describeGatewayRestart(impact),
        GATEWAY_RESTART_TITLE,
        {
          confirmLabel,
        },
      );
    };

  const inspectionNote = payload
    ? ` Needs request inspection for ${payload.host}${narrow?.willRestart ? ", which restarts the network gateway (~5–15s)" : ""}.`
    : "";

  return {
    narrowRestarts: narrow?.willRestart ?? false,
    hostRestarts: host?.willRestart ?? false,
    confirmNarrow: confirmFor(narrow),
    confirmHost: confirmFor(host),
    permanentTooltip: `Allow this exact path on this host (writes a rule).${inspectionNote}`,
    denyForeverTooltip: `Deny this exact path on this host (writes a deny rule).${inspectionNote}`,
    allowHostTooltip: payload
      ? `Allow all requests to ${payload.host} (writes a wildcard rule). No request inspection, so the gateway keeps running.`
      : "Allow all requests to this host (writes a wildcard rule).",
  };
}
