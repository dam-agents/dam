/** A fork as the visibility surfaces see it (#2843): the durable
 *  per-(Agent, replier) runtime a Slack foreign reply runs on. `podRunning`
 *  marks live pods — i.e. compute currently reserving the replier's Budget;
 *  a hibernated fork keeps its identity but reserves nothing. */
export interface ForkView {
  forkId: string;
  /** The parent Agent the fork derives from. */
  agentId: string;
  /** Keycloak sub of the replier the fork acts as. */
  replierSub: string;
  phase: "Pending" | "Ready" | "Hibernated" | "Failed" | "Completed" | null;
  podRunning: boolean;
  lastActivityAt: string | null;
}

export interface ForksUiService {
  /** Forks of one of the caller's agents (owner visibility). */
  listByAgent(agentId: string): Promise<ForkView[]>;
  /** Forks acting as the caller (their budget itemization). */
  listMine(): Promise<ForkView[]>;
  /** Delete a fork now. Allowed for the parent agent's owner and for the
   *  replier the fork acts as. */
  end(forkId: string): Promise<void>;
}
