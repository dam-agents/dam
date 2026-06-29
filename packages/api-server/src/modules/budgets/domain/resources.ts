/** CPU (millicores) and memory (bytes) — the two budgeted dimensions. */
export interface ResourceAmount {
  cpuMilli: number;
  memoryBytes: number;
}

/** Raw K8s request strings off an agent's `spec.resources.requests`. */
export interface ResourceRequests {
  cpu?: string;
  memory?: string;
}

export const ZERO: ResourceAmount = { cpuMilli: 0, memoryBytes: 0 };

/** Fixed per-agent gateway (Envoy) requests; added as a constant since the api-server never renders it. */
export const GATEWAY: ResourceAmount = {
  cpuMilli: 50,
  memoryBytes: 64 * 1024 * 1024,
};

const MEM_UNITS: Record<string, number> = {
  Ki: 1024,
  Mi: 1024 ** 2,
  Gi: 1024 ** 3,
  Ti: 1024 ** 4,
  k: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
};

/** "250m" → 250, "1" → 1000; unparseable → 0. */
export function parseCpuMilli(q: string): number {
  const s = q.trim();
  const n = s.endsWith("m") ? Number(s.slice(0, -1)) : Number(s) * 1000;
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/** "512Mi" → 536870912, "8Gi" → …, plain bytes when no unit. */
export function parseMemoryBytes(q: string): number {
  const m = q.trim().match(/^(\d+(?:\.\d+)?)([A-Za-z]+)?$/);
  if (!m) return 0;
  const factor = m[2] ? (MEM_UNITS[m[2]] ?? 1) : 1;
  return Math.round(Number(m[1]) * factor);
}

export function parseAmount(cpu: string, memory: string): ResourceAmount {
  return {
    cpuMilli: parseCpuMilli(cpu),
    memoryBytes: parseMemoryBytes(memory),
  };
}

export function add(a: ResourceAmount, b: ResourceAmount): ResourceAmount {
  return {
    cpuMilli: a.cpuMilli + b.cpuMilli,
    memoryBytes: a.memoryBytes + b.memoryBytes,
  };
}

/** An agent's reserved footprint: its requests (or chart default) plus the gateway. */
export function footprint(
  requests: ResourceRequests | undefined,
  agentDefault: ResourceAmount,
): ResourceAmount {
  return add(GATEWAY, {
    cpuMilli: requests?.cpu
      ? parseCpuMilli(requests.cpu)
      : agentDefault.cpuMilli,
    memoryBytes: requests?.memory
      ? parseMemoryBytes(requests.memory)
      : agentDefault.memoryBytes,
  });
}

/** True when adding `candidate` to `reserved` would breach `limit` on either dimension. */
export function wouldExceed(
  reserved: ResourceAmount,
  candidate: ResourceAmount,
  limit: ResourceAmount,
): boolean {
  return (
    reserved.cpuMilli + candidate.cpuMilli > limit.cpuMilli ||
    reserved.memoryBytes + candidate.memoryBytes > limit.memoryBytes
  );
}
