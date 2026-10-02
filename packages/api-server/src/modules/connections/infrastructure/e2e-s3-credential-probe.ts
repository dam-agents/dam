import type { S3CredentialProbe } from "../domain/s3-credential-probe.js";

/** Accepts every key pair: the e2e suite has no real S3 endpoint to ask. Wired only when E2E_ENABLED is on. */
export function createE2eS3CredentialProbe(): S3CredentialProbe {
  return {
    verify: () => Promise.resolve("ok"),
  };
}
