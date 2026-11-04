export const NOT_READY_RETRY_MS = 3_000;
const KEPT_MAX = 10_000;

export interface ReadinessKey {
  agentId: string;
  endpoint: string;
  ready?: string;
}

export interface EndpointReadiness<T extends ReadinessKey> {
  ready(target: T): Promise<boolean>;
  failed(target: T): void;
  forget(agentId: string): void;
}

type Known = { ready: true } | { ready: false; at: number };

/**
 * UNIT_BOUNDARY_DESCRIPTION: Whether the app behind one endpoint of an
 * Environment answers yet, as the gate decides it before it relays. A probe
 * decides it: the endpoint's readiness path answers 2xx or 3xx, or, with no
 * path, its port answers at all. A "not ready" is kept for a few seconds, so
 * a page full of requests costs one probe, and probes running at once share
 * one. A "ready" is kept until a relay to the endpoint fails to connect or the
 * Environment wakes again, so a running app costs no probe per request.
 * Several endpoints may share one port behind a router that tells them apart
 * by host name, so each endpoint is decided on its own, and a changed
 * readiness path is probed afresh.
 */
export function createEndpointReadiness<T extends ReadinessKey>(deps: {
  probe: (target: T) => Promise<boolean>;
  now?: () => number;
  retryMs?: number;
}): EndpointReadiness<T> {
  const now = deps.now ?? (() => Date.now());
  const retryMs = deps.retryMs ?? NOT_READY_RETRY_MS;
  const known = new Map<string, Known>();
  const probing = new Map<string, Promise<boolean>>();
  const key = (t: ReadinessKey) =>
    `${t.agentId}:${t.endpoint}:${t.ready ?? ""}`;

  function keep(k: string, value: Known) {
    if (known.size >= KEPT_MAX) known.clear();
    known.set(k, value);
  }

  return {
    async ready(target) {
      const k = key(target);
      const held = known.get(k);
      if (held?.ready) return true;
      if (held && now() - held.at < retryMs) return false;
      const running = probing.get(k);
      if (running) return running;
      const probe = deps
        .probe(target)
        .catch(() => false)
        .then((ready) => {
          keep(k, ready ? { ready: true } : { ready: false, at: now() });
          return ready;
        })
        .finally(() => probing.delete(k));
      probing.set(k, probe);
      return probe;
    },

    failed(target) {
      known.delete(key(target));
    },

    forget(agentId) {
      for (const k of known.keys())
        if (k.startsWith(`${agentId}:`)) known.delete(k);
    },
  };
}
