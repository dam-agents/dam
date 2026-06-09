import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

const versionResponseSchema = z.object({ appVersion: z.string() });

export const versionKeys = {
  all: () => ["version"] as const,
};

export function useAppVersion() {
  return useQuery({
    queryKey: versionKeys.all(),
    queryFn: async () => {
      const res = await fetch("/api/version", { credentials: "omit" });
      if (!res.ok) throw new Error(`Failed to fetch version (${res.status})`);
      return versionResponseSchema.parse(await res.json()).appVersion;
    },
    staleTime: Infinity,
    meta: { errorToast: "Couldn't load version" },
  });
}
