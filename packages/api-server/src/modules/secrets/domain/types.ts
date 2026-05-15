import { PROVIDERS, type SecretType } from "api-server-api";

/**
 * Resolves the canonical host pattern for a secret type. Provider presets
 * pull from {@link PROVIDERS}; generic secrets must come with a user-supplied
 * host.
 */
export function hostPatternFor(type: SecretType, userSupplied?: string): string {
  if (type !== "generic") return PROVIDERS[type].hostPattern;
  if (!userSupplied) throw new Error("hostPattern is required for generic secrets");
  return userSupplied;
}

/**
 * Resolves the path pattern for a secret type. Provider presets that scope
 * injection to a path (e.g. OpenAI's `/v1/*`) supply it via the registry;
 * other presets and generic secrets fall through.
 */
export function pathPatternFor(type: SecretType): string | undefined {
  if (type === "generic") return undefined;
  return PROVIDERS[type].pathPattern;
}
