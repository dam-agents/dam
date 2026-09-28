import { useMutation } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";
import { useAttention } from "../api/queries.js";
import {
  dismissalsByKey,
  type DismissalTarget,
  dismissalTarget,
  isDismissedItem,
  sessionDismissedAt,
} from "../lib/dismissals.js";
import type { FeedItem } from "../lib/feed-item.js";

interface Dismissals {
  isDismissed: (item: FeedItem) => boolean;
  dismiss: (items: readonly FeedItem[]) => void;
  dismissedAt: (agentId: string, sessionId: string) => number | null;
}

export function useDismissals(): Dismissals {
  const attention = useAttention();
  const dismissItems = useMutation({
    ...trpc.attention.dismiss.mutationOptions(),
    meta: { errorToast: "Couldn't dismiss" },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: trpc.attention.listForOwner.queryKey(),
      }),
  });

  const byKey = useMemo(
    () => dismissalsByKey(attention.data?.dismissed ?? []),
    [attention.data],
  );

  const isDismissed = useCallback(
    (item: FeedItem) => isDismissedItem(item, byKey),
    [byKey],
  );

  const dismissedAt = useCallback(
    (agentId: string, sessionId: string) =>
      sessionDismissedAt(byKey, agentId, sessionId),
    [byKey],
  );

  const dismiss = useCallback(
    (items: readonly FeedItem[]) => {
      const targets = items
        .map(dismissalTarget)
        .filter((target): target is DismissalTarget => target !== null);
      if (targets.length > 0) dismissItems.mutate({ items: targets });
    },
    [dismissItems],
  );

  return { isDismissed, dismiss, dismissedAt };
}
