import type { TermsDocument } from "api-server-api";

export async function fetchTermsDocument(): Promise<TermsDocument> {
  const res = await fetch("/api/terms");
  if (!res.ok) throw new Error(`Failed to fetch terms (${res.status})`);
  return (await res.json()) as TermsDocument;
}
