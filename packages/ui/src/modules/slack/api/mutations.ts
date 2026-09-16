import { useMutation } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";
import { agentsKeys } from "../../agents/api/queries.js";
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

export function useBindSlackChannel() {
  return useMutation({
    ...trpc.agents.bindSlackChannel.mutationOptions(),
    meta: {
      invalidates: [agentsKeys.listWithChannels(), trpc.agents.list.queryKey()],
    },
  });
}
