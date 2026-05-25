import type { TermsDocument } from "api-server-api";

import { getAccessToken } from "../../../auth.js";

export async function fetchTermsDocument(): Promise<TermsDocument> {
  const res = await fetch("/api/terms");
  if (!res.ok) throw new Error(`Failed to fetch terms (${res.status})`);
  return (await res.json()) as TermsDocument;
}

export async function fetchLatestAcceptance(): Promise<{
  version: string;
  hash: string;
  acceptedAt: string;
} | null> {
  const res = await fetch("/api/trpc/terms.latestAcceptance", {
    headers: { Authorization: `Bearer ${await getAccessToken()}` },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as {
    result?: {
      data?: {
        version: string;
        hash: string;
        acceptedAt: string;
      } | null;
    };
  };
  return body.result?.data ?? null;
}
