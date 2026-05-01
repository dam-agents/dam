import type { ForkSpec, ForkStatus } from "../domain/fork.js";
import type { Result } from "../../../core/result.js";

export type ForeignCredentialMintError =
  | { kind: "TokenExchangeFailed"; detail?: string }
  | { kind: "OnecliRegistrationFailed"; detail?: string }
  | { kind: "AccessDenied"; detail?: string };

export interface MintedForeignCredential {
  readonly accessToken: string;
  readonly agentIdentifier: string;
}

export interface ForeignCredentialsPort {
  mintForeignToken(args: {
    foreignSub: string;
    instanceId: string;
  }): Promise<Result<MintedForeignCredential, ForeignCredentialMintError>>;
}

export type OrchestratorCreateError =
  | { kind: "WriteFailed"; detail?: string }
  | { kind: "AlreadyExists" };

export interface ForkOrchestratorPort {
  /**
   * Write the fork ConfigMap. `accessToken` is omitted on the Envoy path
   * (ADR-033): the controller resolves the replier's K8s credential
   * Secrets at render time using `spec.foreignSub`, so no minted OneCLI
   * token is needed in `spec.yaml`.
   */
  createFork(args: {
    forkId: string;
    spec: ForkSpec;
    accessToken?: string;
  }): Promise<Result<void, OrchestratorCreateError>>;

  watchStatus(forkId: string): AsyncIterable<ForkStatus>;

  deleteFork(forkId: string): Promise<void>;
}
