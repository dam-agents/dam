import { useMutation } from "@tanstack/react-query";

import { api } from "../../../api.js";
import { trpc } from "../../../trpc.js";
import { agentsKeys } from "../../agents/api/queries.js";
import { withFlowSteps } from "../../usage/lib/ui-telemetry.js";
import { fetchSlackInstallLink } from "./install.js";

export function useStartSlackInstall() {
  return useMutation({
    mutationFn: fetchSlackInstallLink,
    onSuccess: (url) => {
      window.location.href = url;
    },
    meta: { errorToast: "Couldn't start the Slack install" },
  });
}

export function useSlackInvitationLink() {
  return useMutation({
    mutationFn: fetchSlackInstallLink,
    meta: { errorToast: "Couldn't create the invitation link" },
  });
}

export function useBindSlackChannel() {
  return useMutation({
    mutationKey: trpc.agents.bindSlackChannel.mutationKey(),
    mutationFn: withFlowSteps(
      "connect_slack",
      (input: Parameters<typeof api.agents.bindSlackChannel.mutate>[0]) =>
        api.agents.bindSlackChannel.mutate(input),
    ),
    meta: {
      invalidates: [agentsKeys.listWithChannels(), trpc.attention.pathKey()],
    },
  });
}
