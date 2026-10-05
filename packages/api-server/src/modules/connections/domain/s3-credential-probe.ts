export interface S3CredentialProbeInput {
  endpoint: string;
  region: string;
  bucket?: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export type S3CredentialProbeFailure =
  "refused" | "no-such-bucket" | "unreachable" | "failed";

export type S3CredentialProbeOutcome =
  | { ok: true }
  | { ok: false; reason: S3CredentialProbeFailure; detail: string };

export interface S3CredentialProbe {
  probe(input: S3CredentialProbeInput): Promise<S3CredentialProbeOutcome>;
}
