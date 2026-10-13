import { orderByAlias, type ProviderPresetType } from "api-server-api";

export interface DriverProvider {
  id: string;
  type: ProviderPresetType;
}

export type InheritedProvider =
  | { kind: "none" }
  | { kind: "inherited"; id: string }
  | { kind: "incompatible"; offered: ProviderPresetType[] };

export function inheritProvider(
  driverProviders: readonly DriverProvider[],
  targetRunsOn: readonly ProviderPresetType[] | undefined,
): InheritedProvider {
  if (driverProviders.length === 0) return { kind: "none" };
  const accepts = (p: DriverProvider): boolean =>
    !targetRunsOn || targetRunsOn.length === 0 || targetRunsOn.includes(p.type);
  const match = orderByAlias(driverProviders).find(accepts);
  if (match) return { kind: "inherited", id: match.id };
  return {
    kind: "incompatible",
    offered: driverProviders.map((p) => p.type),
  };
}
