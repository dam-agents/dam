import type { ProviderPresetType } from "api-server-api";

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
  if (!targetRunsOn || targetRunsOn.length === 0)
    return { kind: "inherited", id: driverProviders[0]!.id };
  const match = driverProviders.find((p) => targetRunsOn.includes(p.type));
  if (match) return { kind: "inherited", id: match.id };
  return {
    kind: "incompatible",
    offered: driverProviders.map((p) => p.type),
  };
}
