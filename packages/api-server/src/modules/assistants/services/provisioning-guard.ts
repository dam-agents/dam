/* UNIT_BOUNDARY_DESCRIPTION: the request-path provisioning runs behind this guard, per replica: a request starts it and returns, one create runs per owner at a time, and a request that finds one already running starts nothing. The record's own primary key settles the same claim across replicas, so this only spares one replica a second attempt it would lose anyway. A failure is the create's to report on its next attempt: nothing here raises, and the request it came with is already answered. */

export interface ProvisioningGuard {
  start(owner: string, work: () => Promise<unknown>): void;
  running(owner: string): boolean;
}

export function createProvisioningGuard(): ProvisioningGuard {
  const inFlight = new Set<string>();
  return {
    start(owner, work) {
      if (inFlight.has(owner)) return;
      inFlight.add(owner);
      void work()
        .catch(() => {})
        .finally(() => inFlight.delete(owner));
    },
    running: (owner) => inFlight.has(owner),
  };
}
