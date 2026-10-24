import { useQuery } from "@tanstack/react-query";
import type { Links } from "api-server-api";

import { isExternalHttpUrl } from "@/lib/external-link";

import { trpc } from "../../../trpc.js";
import { type DocsPage, docsPageUrl } from "../lib/docs-pages.js";

export function useLinks() {
  return useQuery({
    ...trpc.links.all.queryOptions(),
    staleTime: Infinity,
  });
}

function useExternalLink(name: keyof Links): string | null {
  const href = useLinks().data?.[name];
  return href && isExternalHttpUrl(href) ? href : null;
}

export function useSlackInstallRequestUrl(): string | null {
  return useExternalLink("slackInstallRequest");
}

export function useComputeRequestUrl(): string | null {
  return useExternalLink("computeRequest");
}

export function useCurveBenderCommunityUrl(): string | null {
  return useExternalLink("curveBenderCommunity");
}

export function useDocsUrl(page: DocsPage): string | null {
  const root = useExternalLink("docs");
  return root && docsPageUrl(root, page);
}
