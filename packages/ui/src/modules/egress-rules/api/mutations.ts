import { useMutation } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";
import { approvalsKeys } from "../../approvals/api/queries.js";
import { egressRulesKeys } from "./queries.js";

export function useCreateEgressRule() {
  return useMutation({
    ...trpc.egressRules.create.mutationOptions(),
    meta: {
      invalidates: [egressRulesKeys.all, approvalsKeys.all],
      errorToast: "Couldn't add egress rule",
    },
  });
}

export function useRevokeEgressRule() {
  return useMutation({
    ...trpc.egressRules.revoke.mutationOptions(),
    meta: {
      invalidates: [egressRulesKeys.all, approvalsKeys.all],
      errorToast: "Couldn't revoke egress rule",
    },
  });
}

export function useApplyEgressPreset() {
  return useMutation({
    ...trpc.egressRules.applyPreset.mutationOptions(),
    meta: {
      invalidates: [egressRulesKeys.all, approvalsKeys.all],
      errorToast: "Couldn't apply preset",
    },
  });
}
