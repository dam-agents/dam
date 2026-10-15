import {
  aliasForProviderType,
  orderByAlias,
  type ProviderPresetType,
} from "api-server-api";

export interface DriverProvider {
  id: string;
  type: ProviderPresetType;
}

export type InheritedProvider =
  | { kind: "none" }
  | { kind: "inherited"; id: string }
  | { kind: "incompatible"; offered: ProviderPresetType[] };

/**
 * UNIT_BOUNDARY_DESCRIPTION: the one provider a sub-agent inherits from its
 * driver: the one its requested model names, else the first in the target
 * harness's home order, among those the target accepts; a model whose
 * provider the target cannot take is incompatible, not silently another.
 */
export function inheritProvider(
  driverProviders: readonly DriverProvider[],
  target: {
    runsOn?: readonly ProviderPresetType[] | undefined;
    alias?: string;
    harness?: string;
  },
): InheritedProvider {
  if (driverProviders.length === 0) return { kind: "none" };
  const accepts = (p: DriverProvider): boolean =>
    !target.runsOn ||
    target.runsOn.length === 0 ||
    target.runsOn.includes(p.type);
  const candidates =
    target.alias === undefined
      ? orderByAlias(driverProviders, target.harness)
      : driverProviders.filter(
          (p) => aliasForProviderType(p.type) === target.alias,
        );
  const match = candidates.find(accepts);
  if (match) return { kind: "inherited", id: match.id };
  return {
    kind: "incompatible",
    offered: candidates.map((p) => p.type),
  };
}
