import { useQuery } from "@tanstack/react-query";

import { fetchUsageInspectAvailability } from "./inspect.js";

const usageInspectKeys = {
  availability: () => ["usage", "inspect", "availability"] as const,
};

export function useUsageInspectAvailability() {
  return useQuery({
    queryKey: usageInspectKeys.availability(),
    queryFn: fetchUsageInspectAvailability,
    staleTime: 5 * 60_000,
    meta: { errorToast: "Couldn't check whether you can see usage analytics" },
  });
}
