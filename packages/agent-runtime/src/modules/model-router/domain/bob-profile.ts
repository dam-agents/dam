export interface BobProfilePins {
  teamId: string | null;
  instanceId: string | null;
}

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const firstWhere = <T>(list: T[], hit: (item: T) => boolean): T[] => {
  const at = list.findIndex(hit);
  return at <= 0
    ? list
    : [list[at]!, ...list.slice(0, at), ...list.slice(at + 1)];
};

const teamsOf = (instance: Json): Json[] =>
  Array.isArray(instance.teams) ? instance.teams.filter(isObject) : [];

/**
 * UNIT_BOUNDARY_DESCRIPTION: the profile Bob reads from `GET
 * /admin/v1/profile`, as the router hands it on. Bob flattens
 * `instances[].teams[]` in order and runs on the first entry, stamping its
 * team and instance on every later call, so the Connection's pinned instance
 * and the instance holding its pinned team move first, and the pinned team
 * first within it; an unknown pin changes nothing. Every instance loses
 * `region_domain`: Bob would otherwise send all its calls, model calls
 * included, to `api.<region_domain>` instead of the router. A body that is
 * not a profile passes unchanged.
 */
export function rewriteBobProfile(text: string, pins: BobProfilePins): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }
  if (!isObject(parsed) || !Array.isArray(parsed.instances)) return text;
  const instances = parsed.instances.map((raw: unknown) => {
    if (!isObject(raw)) return raw;
    const { region_domain: _region, ...instance } = raw;
    return pins.teamId === null
      ? instance
      : {
          ...instance,
          teams: firstWhere(teamsOf(instance), (t) => t.id === pins.teamId),
        };
  });
  const byTeam = firstWhere(
    instances,
    (i) =>
      pins.teamId !== null &&
      isObject(i) &&
      teamsOf(i).some((t) => t.id === pins.teamId),
  );
  const ordered = firstWhere(
    byTeam,
    (i) =>
      pins.instanceId !== null &&
      isObject(i) &&
      i.instance_id === pins.instanceId,
  );
  return JSON.stringify({ ...parsed, instances: ordered });
}
