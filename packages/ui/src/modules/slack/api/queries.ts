import { useQuery } from "@tanstack/react-query";

import { fetchSlackInstallAvailability } from "./install.js";

export const slackInstallKeys = {
  availability: () => ["slack", "install", "availability"] as const,
};

export function useSlackInstallAvailability() {
  return useQuery({
    queryKey: slackInstallKeys.availability(),
    queryFn: fetchSlackInstallAvailability,
    staleTime: 5 * 60_000,
    meta: { errorToast: "Couldn't check whether you can connect a workspace" },
  });
}
