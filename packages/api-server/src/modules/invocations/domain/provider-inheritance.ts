import {
  aliasForProviderType,
  orderByAlias,
  PROVIDER_PRESET_TYPES,
  PROVIDERS,
  type ProviderPresetType,
} from "api-server-api";

export interface DriverProvider {
  id: string;
  type: ProviderPresetType;
}

export type InheritedProvider =
  | { kind: "none" }
  | { kind: "inherited"; id: string }
  | { kind: "incompatible" };

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
  return { kind: "incompatible" };
}

const providerNames = (types: readonly ProviderPresetType[]): string =>
  [...new Set(types.map((t) => PROVIDERS[t].displayName))].join(", ");

/**
 * UNIT_BOUNDARY_DESCRIPTION: a spawn refused for lack of a provider says
 * which providers would do and how the user gets one: attach a provider the
 * owner already holds on the agent's Providers page, or connect one in
 * Settings first. The agent relays it, so it names providers the way
 * Settings does.
 */
export function missingProviderMessage(input: {
  harness?: string | undefined;
  runsOn: readonly ProviderPresetType[];
  alias?: string | undefined;
  attachable: readonly ProviderPresetType[];
}): string {
  const wanted = (
    input.alias === undefined
      ? input.runsOn.length > 0
        ? input.runsOn
        : PROVIDER_PRESET_TYPES
      : PROVIDER_PRESET_TYPES.filter(
          (t) => aliasForProviderType(t) === input.alias,
        )
  ).filter((t) => input.runsOn.length === 0 || input.runsOn.includes(t));
  const target = input.harness ?? "the sub-agent";
  const problem =
    input.alias === undefined
      ? `${target} runs on ${providerNames(wanted)}, and this agent holds none of them`
      : `the model names the ${input.alias} provider, and this agent holds none that ${target} runs on`;
  const attachable = input.attachable.filter((t) => wanted.includes(t));
  const fix =
    attachable.length > 0
      ? `ask the user to attach ${providerNames(attachable)} on this agent's Providers page`
      : wanted.length > 0
        ? `ask the user to connect ${providerNames(wanted)} in Settings and attach it on this agent's Providers page`
        : `no provider fits ${target}`;
  return `${problem}; ${fix}`;
}
