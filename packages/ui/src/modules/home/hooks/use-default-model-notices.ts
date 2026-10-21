import { useMutation } from "@tanstack/react-query";
import type { DefaultModelNotice } from "api-server-api";
import { useCallback, useMemo } from "react";

import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";
import { useAttention } from "../api/queries.js";

interface DefaultModelNotices {
  all: readonly DefaultModelNotice[];
  byAgentEvenDismissed: ReadonlyMap<string, readonly DefaultModelNotice[]>;
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

  const { all, byAgentEvenDismissed, waiting } = useMemo(() => {
    const notices = attention.data?.defaultModels ?? [];
    const byAgent = new Map<string, DefaultModelNotice[]>();
    for (const notice of notices)
      byAgent.set(notice.agentId, [
        ...(byAgent.get(notice.agentId) ?? []),
        notice,
      ]);
    const dismissed = new Set(
      (attention.data?.dismissed ?? [])
        .filter((d) => d.kind === "default-model")
        .map((d) => d.id),
    );
    return {
      all: notices,
      byAgentEvenDismissed: byAgent,
      waiting: notices.filter((n) => !dismissed.has(n.id)),
    };
  }, [attention.data]);

  const dismiss = useCallback(
    (notice: DefaultModelNotice) =>
      dismissItems.mutate({
        items: [{ kind: "default-model", id: notice.id }],
      }),
    [dismissItems],
  );

  return { all, byAgentEvenDismissed, waiting, dismiss };
}
