import type { Result } from "../../result.js";

export type SshDomainError = { kind: "Invalid"; reason: string };

export interface SshService {
  /** Idempotently append an SSH public key to the agent's authorized_keys. */
  authorizeKey: (
    publicKey: string,
  ) => Promise<Result<{ ok: true }, SshDomainError>>;
}
