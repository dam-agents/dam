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

export interface TermsService {
  current(): TermsCurrent;
  document(): TermsDocument;
  accept(sub: string, version: string): Promise<void>;
  latestAcceptance(sub: string): Promise<AcceptedAcceptance | null>;
  isAccepted(sub: string): Promise<boolean>;
}
