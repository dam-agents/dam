import type {
  StarterKitEntryPublisher,
  StarterKitPublisher,
} from "api-server-api";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Who publishes a catalog kit. Only the catalog
 * entry can say, because the catalog's reviewers write catalog.yaml and a
 * kit's own kit.yaml could claim anything. An entry that names no publisher is
 * the platform team's kit, and every kit of the built-in catalog is the team's
 * whatever its entry says, because that catalog ships with the release.
 */
export function kitPublisher(
  catalog: { builtin: boolean },
  named: StarterKitEntryPublisher | undefined,
): StarterKitPublisher {
  if (catalog.builtin || named === undefined) return { kind: "team" };
  return {
    kind: "user",
    name: named.name,
    ...(named.url ? { url: named.url } : {}),
  };
}
