import { useQuery } from "@tanstack/react-query";

import { isExternalHttpUrl } from "@/lib/external-link";

import { trpc } from "../../../trpc.js";

export function useLinks() {
  return useQuery({
    ...trpc.links.all.queryOptions(),
    staleTime: Infinity,
  });
}

export function useSlackInstallRequestUrl(): string | null {
  const href = useLinks().data?.slackInstallRequest;
  return href && isExternalHttpUrl(href) ? href : null;
}
