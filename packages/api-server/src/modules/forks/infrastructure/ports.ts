import type { ForkSpec, ForkStatus } from "../domain/fork.js";
import type { Result } from "../../../core/result.js";

export type OrchestratorCreateError =
  | { kind: "WriteFailed"; detail?: string }
  | { kind: "AlreadyExists" };

export interface ForkOrchestratorPort {
  /**
   * Write the fork ConfigMap. The controller resolves the replier's K8s
   * credential Secrets at render time using `spec.foreignSub`.
   */
  createFork(args: {
    forkId: string;
    spec: ForkSpec;
  }): Promise<Result<void, OrchestratorCreateError>>;

  watchStatus(forkId: string): AsyncIterable<ForkStatus>;

  deleteFork(forkId: string): Promise<void>;
}
