import { useQuery } from "@tanstack/react-query";

import {
  fetchUsageInspectAvailability,
  fetchUsageReportHtml,
} from "./inspect.js";

const usageInspectKeys = {
  availability: () => ["usage", "inspect", "availability"] as const,
  report: () => ["usage", "inspect", "report"] as const,
};

export function useUsageInspectAvailability() {
  return useQuery({
    queryKey: usageInspectKeys.availability(),
    queryFn: fetchUsageInspectAvailability,
    staleTime: 5 * 60_000,
    meta: { errorToast: "Couldn't check whether you can see usage analytics" },
  });
}

export function useUsageReportHtml() {
  return useQuery({
    queryKey: usageInspectKeys.report(),
    queryFn: fetchUsageReportHtml,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
