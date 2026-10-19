import { useMutation } from "@tanstack/react-query";
import type { DefaultModelNotice } from "api-server-api";
import { useCallback, useMemo } from "react";

import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";
import { useAttention } from "../api/queries.js";
import { defaultModelNoticeId } from "../lib/default-model-copy.js";

interface DefaultModelNotices {
  byAgentEvenDismissed: ReadonlyMap<string, DefaultModelNotice>;
  waiting: readonly DefaultModelNotice[];
  dismiss: (notice: DefaultModelNotice) => void;
}

export function useDefaultModelNotices(): DefaultModelNotices {
  const attention = useAttention();
  const dismissItems = useMutation({
    ...trpc.attention.dismiss.mutationOptions(),
    meta: { errorToast: "Couldn't dismiss" },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: trpc.attention.listForOwner.queryKey(),
      }),
  });

  const { byAgentEvenDismissed, waiting } = useMemo(() => {
    const notices = attention.data?.defaultModels ?? [];
    const dismissed = new Set(
      (attention.data?.dismissed ?? [])
        .filter((d) => d.kind === "default-model")
        .map((d) => d.id),
    );
    return {
      byAgentEvenDismissed: new Map(
        notices.map((n) => [n.agentId, n] as const),
      ),
      waiting: notices.filter((n) => !dismissed.has(defaultModelNoticeId(n))),
    };
  }, [attention.data]);

  const dismiss = useCallback(
    (notice: DefaultModelNotice) =>
      dismissItems.mutate({
        items: [{ kind: "default-model", id: defaultModelNoticeId(notice) }],
      }),
    [dismissItems],
  );

  return { byAgentEvenDismissed, waiting, dismiss };
}
