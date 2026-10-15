export interface TermsCurrent {
  version: string;
  hash: string;
}

export interface TermsDocument {
  version: string;
  text: string;
  hash: string;
}

export interface StaleAcceptance {
  error: "terms_stale";
  currentVersion: string;
  currentHash: string;
}

export interface AcceptedAcceptance {
  version: string;
  hash: string;
  acceptedAt: Date;
}

export type AcceptTermsResult =
  { ok: true; value: null } | { ok: false; error: { type: "SignUpsClosed" } };

export interface TermsService {
  current(): TermsCurrent;
  document(): TermsDocument;
  accept(sub: string, version: string): Promise<AcceptTermsResult>;
  latestAcceptance(sub: string): Promise<AcceptedAcceptance | null>;
  isAccepted(sub: string): Promise<boolean>;
}

export const PRE_TERMS_PROCEDURES: ReadonlySet<string> = new Set([
  "terms.current",
  "terms.latestAcceptance",
  "terms.accept",
]);
