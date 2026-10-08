import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ProcessList } from "agent-runtime-api";

import { processesClientFor } from "./client.js";
import { processKeys } from "./keys.js";

function useRefreshProcesses(agentId: string) {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: processKeys.agent(agentId) });
}

export function useStopProcess(agentId: string) {
  const refresh = useRefreshProcesses(agentId);
  return useMutation({
    mutationFn: (key: string) =>
      processesClientFor(agentId).processes.stop.mutate({ key }),
    onSettled: refresh,
    meta: { errorToast: "Couldn't stop the process" },
  });
}

export function useSetKeep(agentId: string) {
  const queryClient = useQueryClient();
  const refresh = useRefreshProcesses(agentId);
  const listKey = processKeys.list(agentId);
  return useMutation({
    mutationFn: (input: { key: string; keepsAwake: boolean }) =>
      processesClientFor(agentId).processes.setKeep.mutate(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: listKey });
      const snapshot = queryClient.getQueryData<ProcessList>(listKey);
      queryClient.setQueryData<ProcessList>(listKey, (list) =>
        list
          ? {
              ...list,
              running: list.running.map((row) =>
                row.key === input.key
                  ? { ...row, keepsAwake: input.keepsAwake, keepSource: "user" }
                  : row,
              ),
            }
          : list,
      );
      return { snapshot };
    },
    onError: (_error, _input, context) =>
      queryClient.setQueryData(listKey, context?.snapshot),
    onSettled: refresh,
    meta: { errorToast: "Couldn't change whether it keeps the agent awake" },
  });
}

export function useApplyPendingRestart(agentId: string) {
  const refresh = useRefreshProcesses(agentId);
  return useMutation({
    mutationFn: () =>
      processesClientFor(agentId).processes.applyPendingRestart.mutate(),
    onSettled: refresh,
    meta: { errorToast: "Couldn't apply the change" },
  });
}
