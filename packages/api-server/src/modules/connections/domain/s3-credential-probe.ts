export type S3ProbeOutcome =
  "ok" | "refused" | "unreachable" | "no-such-bucket";

export interface S3CredentialProbe {
  verify(input: {
    endpoint: string;
    region: string;
    bucket?: string;
    accessKeyId: string;
    secretAccessKey: string;
  }): Promise<S3ProbeOutcome>;
}
