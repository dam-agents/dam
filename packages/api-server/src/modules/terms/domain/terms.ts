import type { TermsCurrent, TermsDocument } from "api-server-api";

export type CurrentTerms = TermsDocument;

export function buildCurrent(terms: CurrentTerms): TermsCurrent {
  return { version: terms.version, hash: terms.hash };
}

export function buildDocument(terms: CurrentTerms): TermsDocument {
  return { version: terms.version, text: terms.text, hash: terms.hash };
}
