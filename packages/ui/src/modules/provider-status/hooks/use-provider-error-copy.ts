import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { trpc } from "../../../trpc.js";
import { useOutageFor } from "../api/queries.js";
import type { StatusLink } from "../lib/banner-state.js";
import { type ProviderErrorCopy, providerErrorCopy } from "../lib/copy.js";
import { providerNameFor } from "../lib/provider-name.js";

export function useProviderErrorCopy(
  templateId: string | null,
  interrupted: boolean,
): ProviderErrorCopy & { statusLink: StatusLink | null } {
  const queryClient = useQueryClient();
  useEffect(() => {
    void queryClient.invalidateQueries(
      { queryKey: trpc.providerStatus.list.queryKey() },
      { cancelRefetch: false },
    );
  }, [queryClient]);
  const condition = useOutageFor(templateId);
  const [sawOutage, setSawOutage] = useState(false);
  if (condition.kind !== "no-outage" && !sawOutage) setSawOutage(true);
  const providerName = providerNameFor(templateId);
  const statusPageUrl =
    condition.kind === "degraded" ? condition.outage.statusPageUrl : null;
  return {
    ...providerErrorCopy({
      condition,
      providerName,
      interrupted,
      recovered: sawOutage && condition.kind === "no-outage",
    }),
    statusLink:
      statusPageUrl && providerName
        ? { name: providerName, url: statusPageUrl }
        : null,
  };
}
