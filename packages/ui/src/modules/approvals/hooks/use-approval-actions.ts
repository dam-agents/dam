import type { CarbonIconType } from "@carbon/icons-react";
import {
  Checkmark,
  CheckmarkFilled,
  Close,
  Globe,
  Misuse,
} from "@carbon/icons-react";
import type { ApprovalView } from "api-server-api";

import { useStore } from "../../../store.js";
import {
  useApproveHost,
  useApproveOnce,
  useApprovePermanent,
  useDenyForever,
  useDismissApproval,
} from "../api/mutations.js";
import { useEgressApprovalRestart } from "../lib/egress-approval-restart.js";
import { isHeldCallStillLive } from "../lib/hold.js";

export type ApprovalActionId =
  | "allow-once"
  | "allow-permanent"
  | "allow-host"
  | "dismiss"
  | "deny-forever";

export interface ApprovalAction {
  id: ApprovalActionId;
  label: string;
  icon: CarbonIconType;
  danger: boolean;
  disabled: boolean;
  tooltip?: string;
  resolvedLabel: string;
  run: () => Promise<boolean>;
}

export interface ApprovalActions {
  actions: readonly ApprovalAction[];
  inflight: boolean;
  hostLabel: string | null;
  expiredNote: string | null;
  openSettings: () => void;
}

export function useApprovalActions(row: ApprovalView): ApprovalActions {
  const approveOnce = useApproveOnce();
  const approvePermanent = useApprovePermanent();
  const approveHost = useApproveHost();
  const denyForever = useDenyForever();
  const dismiss = useDismissApproval();
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const restart = useEgressApprovalRestart(row);

  const inflight =
    approveOnce.isPending ||
    approvePermanent.isPending ||
    approveHost.isPending ||
    denyForever.isPending ||
    dismiss.isPending;

  const live = isHeldCallStillLive(row);
  const hostLabel = row.payload.kind === "ext_authz" ? row.payload.host : null;
  const allowOnceDisabled = row.type === "ext_authz" ? !live : false;

  const confirmed = async (
    confirm: (label: string) => Promise<boolean>,
    label: string,
    mutate: () => Promise<unknown>,
  ): Promise<boolean> => {
    if (!(await confirm(label))) return false;
    try {
      await mutate();
      return true;
    } catch {
      return false;
    }
  };

  const direct = async (mutate: () => Promise<unknown>): Promise<boolean> => {
    try {
      await mutate();
      return true;
    } catch {
      return false;
    }
  };

  const actions: ApprovalAction[] = [
    {
      id: "allow-once",
      label: "Allow once",
      icon: Checkmark,
      danger: false,
      disabled: inflight || allowOnceDisabled,
      tooltip: allowOnceDisabled
        ? "Original request already failed; pick Allow permanently to allow future retries"
        : undefined,
      resolvedLabel: "Allowed",
      run: () => direct(() => approveOnce.mutateAsync({ id: row.id })),
    },
    {
      id: "allow-permanent",
      label: "Allow permanently",
      icon: CheckmarkFilled,
      danger: false,
      disabled: inflight,
      tooltip: restart.permanentTooltip,
      resolvedLabel: "Allowed permanently",
      run: () =>
        confirmed(restart.confirmNarrow, "Allow & restart", () =>
          approvePermanent.mutateAsync({ id: row.id }),
        ),
    },
    ...(hostLabel
      ? [
          {
            id: "allow-host" as const,
            label: `Allow all of ${hostLabel}`,
            icon: Globe,
            danger: false,
            disabled: inflight,
            tooltip: restart.allowHostTooltip,
            resolvedLabel: `Allowed all of ${hostLabel}`,
            run: () =>
              confirmed(restart.confirmHost, "Allow & restart", () =>
                approveHost.mutateAsync({ id: row.id }),
              ),
          },
        ]
      : []),
    {
      id: "dismiss",
      label: "Deny this request",
      icon: Close,
      danger: true,
      disabled: inflight || !live,
      tooltip: live
        ? "Deny this single request — re-prompts on the next attempt"
        : "Original request already failed; nothing to dismiss",
      resolvedLabel: "Denied",
      run: () => direct(() => dismiss.mutateAsync({ id: row.id })),
    },
    {
      id: "deny-forever",
      label: "Deny permanently",
      icon: Misuse,
      danger: true,
      disabled: inflight,
      tooltip: restart.denyForeverTooltip,
      resolvedLabel: "Denied permanently",
      run: () =>
        confirmed(restart.confirmNarrow, "Deny & restart", () =>
          denyForever.mutateAsync({ id: row.id }),
        ),
    },
  ];

  return {
    actions,
    inflight,
    hostLabel,
    expiredNote:
      row.status === "expired" && row.type === "ext_authz"
        ? "The original request already failed. Allow permanently writes a rule that future retries match."
        : null,
    openSettings: () => navigateToSandboxHome(row.agentId),
  };
}
