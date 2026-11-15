import { useMutation } from "@tanstack/react-query";
import {
  type OwnerQuestionNotice,
  ownerQuestionNoticeKey,
} from "api-server-api";
import { useCallback, useMemo } from "react";

import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";
import { useAttention } from "../api/queries.js";
import { ownerQuestionGroups } from "../lib/owner-question-groups.js";

interface OwnerQuestionNotices {
  waiting: readonly OwnerQuestionNotice[][];
  dismiss: (group: readonly OwnerQuestionNotice[]) => void;
}

// UNIT_BOUNDARY_DESCRIPTION: the sub-agent questions the bell tells, one group per Agent, without the ones the owner dismissed. A dismissal only hides the card: the question still waits, and still takes the input of its chat.
export function useOwnerQuestionNotices(): OwnerQuestionNotices {
  const attention = useAttention();
  const dismissItems = useMutation({
    ...trpc.attention.dismiss.mutationOptions(),
    meta: { errorToast: "Couldn't dismiss" },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: trpc.attention.listForOwner.queryKey(),
      }),
  });

  const waiting = useMemo(() => {
    const dismissed = new Set(
      (attention.data?.dismissed ?? [])
        .filter((d) => d.kind === "owner-question")
        .map((d) => d.id),
    );
    return ownerQuestionGroups(
      (attention.data?.ownerQuestions ?? []).filter(
        (notice) => !dismissed.has(ownerQuestionNoticeKey(notice)),
      ),
    );
  }, [attention.data]);

  const dismiss = useCallback(
    (group: readonly OwnerQuestionNotice[]) =>
      dismissItems.mutate({
        items: group.map((notice) => ({
          kind: "owner-question" as const,
          id: ownerQuestionNoticeKey(notice),
        })),
      }),
    [dismissItems],
  );

  return { waiting, dismiss };
}
