import type { Result } from "../../result.js";

export type SshDomainError = { kind: "Invalid"; reason: string };

export interface SshService {
  authorizeKey: (
    publicKey: string,
  ) => Promise<Result<{ ok: true }, SshDomainError>>;
}
