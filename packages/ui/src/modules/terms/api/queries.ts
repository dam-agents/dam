import { useQuery } from "@tanstack/react-query";
import { termsDocumentSchema } from "api-server-api";

import { trpc } from "../../../trpc.js";

export const termsKeys = {
  all: () => ["terms"] as const,
  document: () => [...termsKeys.all(), "document"] as const,
};

export function useTermsDocument() {
  return useQuery({
    queryKey: termsKeys.document(),
    queryFn: async () => {
      const res = await fetch("/api/terms");
      if (!res.ok) throw new Error(`Failed to fetch terms (${res.status})`);
      return termsDocumentSchema.parse(await res.json());
    },
    staleTime: Infinity,
    meta: { errorToast: "Couldn't load Terms of Use" },
  });
}

export function useLatestAcceptance() {
  return useQuery(trpc.terms.latestAcceptance.queryOptions());
}
