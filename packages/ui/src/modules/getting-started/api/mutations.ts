import { useMutation } from "@tanstack/react-query";
import type { GettingStartedProgress } from "api-server-api";

import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";

const progressKey = () => trpc.gettingStarted.progress.queryKey();

function patchProgress(
  patch: (progress: GettingStartedProgress) => GettingStartedProgress,
) {
  queryClient.setQueryData(progressKey(), (progress) =>
    progress ? patch(progress) : progress,
  );
}

function storeProgress(progress: GettingStartedProgress) {
  queryClient.setQueryData(progressKey(), progress);
}

function refetchProgress() {
  void queryClient.invalidateQueries({ queryKey: progressKey() });
}

export function useMarkUnlockSeen() {
  return useMutation(
    trpc.gettingStarted.markUnlockSeen.mutationOptions({
      onMutate: ({ task }) =>
        patchProgress((p) => ({
          ...p,
          unlocks: p.unlocks.map((u) =>
            u.task === task ? { ...u, seen: true } : u,
          ),
        })),
      onSuccess: storeProgress,
      onError: refetchProgress,
    }),
  );
}

export function useMarkAvatarPicked() {
  return useMutation(
    trpc.gettingStarted.markAvatarPicked.mutationOptions({
      onMutate: ({ character }) =>
        patchProgress((p) => ({
          ...p,
          unlocks: p.unlocks.map((u) =>
            u.character === character ? { ...u, fresh: false } : u,
          ),
        })),
      onSuccess: storeProgress,
      onError: refetchProgress,
    }),
  );
}

export function useSetChecklistDismissed() {
  return useMutation(
    trpc.gettingStarted.setDismissed.mutationOptions({
      onMutate: ({ dismissed }) => patchProgress((p) => ({ ...p, dismissed })),
      onSuccess: storeProgress,
      onError: refetchProgress,
      meta: { errorToast: "Couldn't update the Get started checklist" },
    }),
  );
}
