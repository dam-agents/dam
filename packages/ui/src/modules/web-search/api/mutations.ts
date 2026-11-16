import { useMutation } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";
import { agentsKeys } from "../../agents/api/queries.js";
import { approvalsKeys } from "../../approvals/api/queries.js";

export function useSetWebSearchRule() {
  return useMutation({
    ...trpc.webSearch.setRule.mutationOptions(),
    meta: {
      invalidates: [trpc.webSearch.pathKey(), approvalsKeys.all],
      errorToast: "Couldn't change the web search rule",
    },
  });
}

export function useSetWebSearchControl() {
  return useMutation({
    ...trpc.agents.setWebSearchControl.mutationOptions(),
    meta: {
      invalidates: [agentsKeys.listWithChannels(), trpc.webSearch.pathKey()],
      errorToast: "Couldn't change web search control",
    },
  });
}
