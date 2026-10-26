import type { CarbonIconType } from "@carbon/icons-react";
import {
  Checkmark,
  CheckmarkFilled,
  Close,
  Globe,
  Misuse,
} from "@carbon/icons-react";
import type { ApprovalView } from "api-server-api";
import { match } from "ts-pattern";

import { useStore } from "../../../store.js";
import { continueLabel } from "../../spend/lib/copy.js";
import { localResetTime } from "../../spend/lib/format.js";
import {
  useApproveHost,
  useApproveOnce,
  useApprovePermanent,
  useDenyForever,
  useDismissApproval,
} from "../api/mutations.js";
import { useEgressApprovalRestart } from "../lib/egress-approval-restart.js";

export type ApprovalActionId =
  "allow-once" | "allow-permanent" | "allow-host" | "dismiss" | "deny-forever";

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

interface ApprovalActions {
  actions: readonly ApprovalAction[];
  primary: ApprovalActionId;
  inflight: boolean;
  hostLabel: string | null;
  expiredNote: string | null;
  openSettings: () => void;
}

export function useApprovalActions(
  row: ApprovalView,
  ids: readonly string[] = [row.id],
): ApprovalActions {
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

  const live =
    row.status === "pending" && new Date(row.expiresAt).getTime() > Date.now();
  const hostLabel =
    row.payload.kind === "ext_authz" || row.payload.kind === "egress_proposal"
      ? row.payload.host
      : null;
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

  const each = async (
    mutate: (input: { id: string }) => Promise<unknown>,
  ): Promise<void> => {
    for (const id of ids) await mutate({ id });
  };

  const continueText =
    row.payload.kind === "spend_limit"
      ? continueLabel(row.payload.amountMicros, row.payload.unit)
      : "Continue";

  const spendLimitActions: ApprovalAction[] = [
    {
      id: "allow-once",
      label: continueText,
      icon: Checkmark,
      danger: false,
      disabled: inflight || !live,
      tooltip: live
        ? undefined
        : `The question expired at ${localResetTime(row.expiresAt)} your time`,
      resolvedLabel: "Continued",
      run: () => direct(() => each(approveOnce.mutateAsync)),
    },
    {
      id: "dismiss",
      label: "Stop for today",
      icon: Close,
      danger: true,
      disabled: inflight || !live,
      resolvedLabel: "Stopped for today",
      run: () => direct(() => each(dismiss.mutateAsync)),
    },
  ];

  const egressActions: ApprovalAction[] = [
    {
      id: "allow-once",
      label: "Allow once",
      icon: Checkmark,
      danger: false,
      disabled: inflight || allowOnceDisabled,
      tooltip: allowOnceDisabled
        ? "Original request already failed; pick Always allow to allow future retries"
        : undefined,
      resolvedLabel: "Allowed",
      run: () => direct(() => each(approveOnce.mutateAsync)),
    },
    {
      id: "allow-permanent",
      label: "Always allow…",
      icon: CheckmarkFilled,
      danger: false,
      disabled: inflight,
      tooltip: restart.permanentTooltip,
      resolvedLabel: "Always allowed",
      run: () =>
        confirmed(restart.confirmNarrow, "Allow & restart", () =>
          each(approvePermanent.mutateAsync),
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
                each(approveHost.mutateAsync),
              ),
          },
        ]
      : []),
    {
      id: "dismiss",
      label: "Deny",
      icon: Close,
      danger: true,
      disabled: inflight || !live,
      tooltip: live
        ? "Deny this single request — re-prompts on the next attempt"
        : "Original request already failed; nothing to dismiss",
      resolvedLabel: "Denied",
      run: () => direct(() => each(dismiss.mutateAsync)),
    },
    {
      id: "deny-forever",
      label: "Always deny…",
      icon: Misuse,
      danger: true,
      disabled: inflight,
      tooltip: restart.denyForeverTooltip,
      resolvedLabel: "Always denied",
      run: () =>
        confirmed(restart.confirmNarrow, "Deny & restart", () =>
          each(denyForever.mutateAsync),
        ),
    },
  ];

  const hostWideAction = egressActions.find((a) => a.id === "allow-host");
  const proposalActions: ApprovalAction[] = [
    {
      id: "allow-permanent",
      label: "Allow",
      icon: CheckmarkFilled,
      danger: false,
      disabled: inflight,
      tooltip: "Writes the rule the agent proposed",
      resolvedLabel: "Allowed",
      run: () =>
        confirmed(restart.confirmNarrow, "Allow & restart", () =>
          each(approvePermanent.mutateAsync),
        ),
    },
    ...(hostWideAction ? [hostWideAction] : []),
    {
      id: "dismiss",
      label: "Decline",
      icon: Close,
      danger: true,
      disabled: inflight || !live,
      tooltip: "Write no rule; the agent is told you declined",
      resolvedLabel: "Declined",
      run: () => direct(() => each(dismiss.mutateAsync)),
    },
  ];

  const actions = match(row.type)
    .with("spend_limit", () => spendLimitActions)
    .with("egress_proposal", () => proposalActions)
    .otherwise(() => egressActions);

  return {
    actions,
    primary: row.type === "egress_proposal" ? "allow-permanent" : "allow-once",
    inflight,
    hostLabel,
    expiredNote:
      row.status === "expired" && row.type === "ext_authz"
        ? "The original request already failed. Always allow writes a rule that future retries match."
        : null,
    openSettings: () => navigateToSandboxHome(row.agentId, "services"),
  };
}
