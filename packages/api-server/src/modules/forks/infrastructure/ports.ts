import type { ForkSpec, ForkStatus } from "../domain/fork.js";
import type { Result } from "../../../core/result.js";

export type OrchestratorCreateError =
  | { kind: "WriteFailed"; detail?: string }
  | { kind: "AlreadyExists" };

export interface ForkOrchestratorPort {
  /**
   * Write the Fork CR. The controller resolves the replier's K8s
   * credential Secrets at render time using `spec.foreignSub`.
   */
  createFork(args: {
    forkId: string;
    spec: ForkSpec;
  }): Promise<Result<void, OrchestratorCreateError>>;

  /**
   * Read the fork CR — its spec identity (parent agent + replier) and
   * observed status. `null` when the CR doesn't exist (or its spec is
   * malformed); `status` is null while the controller hasn't written a
   * recognised phase yet.
   */
  getFork(forkId: string): Promise<{
    agentId: string;
    foreignSub: string;
    status: ForkStatus | null;
  } | null>;

  /**
   * Stamp the fork's last-activity annotation — the signal the controller
   * measures the idle tiers against, and the wake poke for a hibernated
   * fork. No-op when the CR is gone.
   */
  bumpActivity(forkId: string): Promise<void>;

  /** Stamp the credentials-rev annotation — a reconcile poke that rolls the
   *  fork gateway when the replier's credential set changed. Distinct from
   *  bumpActivity: it must NOT wake a hibernated fork or hold budget. */
  bumpCredentialsRev(forkId: string): Promise<void>;

  watchStatus(forkId: string): AsyncIterable<ForkStatus>;

  deleteFork(forkId: string): Promise<void>;

  /** List fork CRs, optionally scoped to one parent agent. Malformed CRs
   *  are skipped. `lastActivityAt` is the activity annotation (ISO), null
   *  when never stamped. */
  listForks(filter?: { agentId?: string }): Promise<
    Array<{
      forkId: string;
      agentId: string;
      foreignSub: string;
      status: ForkStatus | null;
      lastActivityAt: string | null;
    }>
  >;
}
