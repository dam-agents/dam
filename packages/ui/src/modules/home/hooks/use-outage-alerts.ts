import { useMutation } from "@tanstack/react-query";
import type { OutageAlertNotice } from "api-server-api";
import { useCallback, useMemo } from "react";

import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";
import { useAttention } from "../api/queries.js";

interface OutageAlerts {
  waiting: readonly OutageAlertNotice[];
  dismiss: (alert: OutageAlertNotice) => void;
}

const shownAt = (alert: OutageAlertNotice) =>
  Date.parse(alert.recoveredAt ?? alert.since);

export function useOutageAlerts(): OutageAlerts {
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
        .filter((d) => d.kind === "outage-alert")
        .map((d) => d.id),
    );
    return (attention.data?.outageAlerts ?? [])
      .filter((alert) => !dismissed.has(alert.id))
      .sort((a, b) => shownAt(b) - shownAt(a));
  }, [attention.data]);

  const dismiss = useCallback(
    (alert: OutageAlertNotice) =>
      dismissItems.mutate({ items: [{ kind: "outage-alert", id: alert.id }] }),
    [dismissItems],
  );

  return { waiting, dismiss };
}
