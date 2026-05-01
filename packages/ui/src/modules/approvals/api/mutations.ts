import { useMutation } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";
import { approvalsKeys } from "./queries.js";

export function useApproveOnce() {
  return useMutation({
    ...trpc.approvals.approveOnce.mutationOptions(),
    meta: {
      invalidates: [approvalsKeys.all],
      errorToast: "Couldn't approve",
    },
  });
}

export function useApprovePermanent() {
  return useMutation({
    ...trpc.approvals.approvePermanent.mutationOptions(),
    meta: {
      invalidates: [approvalsKeys.all],
      errorToast: "Couldn't approve permanently",
    },
  });
}

export function useApproveHost() {
  return useMutation({
    ...trpc.approvals.approveHost.mutationOptions(),
    meta: {
      invalidates: [approvalsKeys.all],
      errorToast: "Couldn't allow host",
    },
  });
}

export function useDenyForever() {
  return useMutation({
    ...trpc.approvals.denyForever.mutationOptions(),
    meta: {
      invalidates: [approvalsKeys.all],
      errorToast: "Couldn't deny",
    },
  });
}

export function useDismissApproval() {
  return useMutation({
    ...trpc.approvals.dismiss.mutationOptions(),
    meta: {
      invalidates: [approvalsKeys.all],
      errorToast: "Couldn't dismiss",
    },
  });
}
