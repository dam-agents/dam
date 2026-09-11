/**
 * UNIT_BOUNDARY_DESCRIPTION: Kubernetes-style quantities, which is the
 * vocabulary an agent's resource limits are written in and therefore the one
 * both the scheduler and the sandbox have to read. It lives here rather than in
 * either of them because two copies drifting would put an agent on a node that
 * cannot hold it.
 */
const SCALE: Record<string, number> = {
  m: 1 / 1000,
  Ki: 1024,
  Mi: 1024 ** 2,
  Gi: 1024 ** 3,
  Ti: 1024 ** 4,
  k: 1000,
  M: 1000 ** 2,
  G: 1000 ** 3,
  T: 1000 ** 4,
};

export function parseQuantity(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(\d+(?:\.\d+)?)(m|Ki|Mi|Gi|Ti|k|M|G|T)?$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * (match[2] ? SCALE[match[2]]! : 1);
}
