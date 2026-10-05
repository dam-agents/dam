import type { S3CredentialProbe } from "../domain/s3-credential-probe.js";

// UNIT_BOUNDARY_DESCRIPTION: The e2e stand-in for the S3 credential probe. The e2e cluster has no S3 endpoint, and its specs point sigv4 Connections at the public echo to watch the gateway re-sign requests, so the probe that would otherwise call HeadBucket or ListBuckets accepts every key pair instead. Only the composition root wires it, and only when the e2e control API is on.
export function createAcceptingS3CredentialProbe(): S3CredentialProbe {
  return {
    probe: async () => ({ ok: true }),
  };
}
