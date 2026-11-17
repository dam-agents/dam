import { useMutation } from "@tanstack/react-query";
import type { SecurityCheckNotice } from "api-server-api";
import { useCallback, useMemo } from "react";

import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";
import { useAttention } from "../../home/api/queries.js";

export interface SecurityCheckNotices {
  waiting: readonly SecurityCheckNotice[];
  dismiss: (notice: SecurityCheckNotice) => void;
}

// UNIT_BOUNDARY_DESCRIPTION: the security check alerts the bell tells, without the ones the owner dismissed. A dismissal names one report, so it hides that alert only and the next report is told again.
export function useSecurityCheckNotices(): SecurityCheckNotices {
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
        .filter((d) => d.kind === "security-check")
        .map((d) => d.id),
    );
    return (attention.data?.securityChecks ?? []).filter(
      (notice) => !dismissed.has(notice.id),
    );
  }, [attention.data]);

  const dismiss = useCallback(
    (notice: SecurityCheckNotice) =>
      dismissItems.mutate({
        items: [{ kind: "security-check" as const, id: notice.id }],
      }),
    [dismissItems],
  );

  return { waiting, dismiss };
}
