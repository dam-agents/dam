/**
 * UNIT_BOUNDARY_DESCRIPTION: the platform's own taste in models, one ordered
 * list per role, because a provider's Connection says which models it serves
 * and never which of them to prefer. A routed harness never sees a preset's
 * env, so nothing else names the classifier's model, and a provider whose ids
 * carry no tier word (CurveBender, the built-in one) has no tier to guess
 * from: an agent that picked no model would run on the newest id the provider
 * happens to list, and a classifier call on the session's own work model.
 * `work` decides a new agent's default model, `classifier` what Claude Code's
 * non-reasoning permission classifier runs on. The order is the preference:
 * the first entry a listing answers wins. `family` is the model's words,
 * `version` the digits right behind them and `variant` the word right behind
 * those, all as tokens of `modelTokens`.
 */
export type ModelRole = "work" | "classifier";

export interface PreferredModel {
  role: ModelRole;
  family: readonly string[];
  version: readonly string[];
  variant?: string;
}

export const PREFERRED_MODELS: readonly PreferredModel[] = [
  { role: "work", family: ["deepseek"], version: ["4", "1"], variant: "flash" },
  { role: "work", family: ["claude", "opus"], version: ["5", "5"] },
  { role: "work", family: ["gpt"], version: ["6", "1"], variant: "sol" },
  {
    role: "classifier",
    family: ["nemotron"],
    version: ["3"],
    variant: "ultra",
  },
  { role: "classifier", family: ["claude", "sonnet"], version: ["5", "5"] },
];

const NOT_AN_ID = /[^a-z0-9]+/g;
const LETTER_THEN_DIGIT = /([a-z])(\d)/g;
const DIGIT_THEN_LETTER = /(\d)([a-z])/g;

/**
 * UNIT_BOUNDARY_DESCRIPTION: an id as its words and digits, so the same model
 * matches however a provider spells it: providers prefix the deployment
 * (`aws/`, `rits/`, `eu/`), vary the case, separate a version with a dot, a
 * dash or an underscore (`opus-5.5`, `opus-5-5`, `opus_5_5`), and glue the
 * version marker to it (`v4.1`). Folding every separator and splitting a
 * letter from a digit that touches it makes all of those one token stream, and
 * a trailing build stamp (`-1017`, `-20251001`) or Claude Code's `[1m]` suffix
 * cannot change the family or the version, since only those two are read.
 */
export function modelTokens(upstreamId: string): string[] {
  return upstreamId
    .toLowerCase()
    .replace(/\[1m\]$/, "")
    .replace(NOT_AN_ID, "-")
    .replace(LETTER_THEN_DIGIT, "$1-$2")
    .replace(DIGIT_THEN_LETTER, "$1-$2")
    .split("-")
    .filter((token) => token.length > 0);
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: whether a listed model is the one a list entry
 * names: the same family with the same version right behind it, an optional
 * `v` between them, then the entry's variant if it has one, and never a
 * substitute. A different version is a different model (DeepSeek 3.2 is not
 * DeepSeek 4.1, and gpt-5.6 is not gpt-6), and so is a different variant
 * (Nemotron 3 Nano is not the Ultra the platform prefers), so a listing that
 * holds only one of those falls through to the next entry rather than running
 * on it unseen. What may still follow is the build stamp providers append
 * (`-1017`, `-20260101`) — digits only, so a word there is a variant.
 */
export function modelMatches(
  tokens: readonly string[],
  pref: PreferredModel,
): boolean {
  const stamp = /^\d+$/;
  return tokens.some((_, at) => {
    if (!pref.family.every((token, offset) => tokens[at + offset] === token))
      return false;
    const versionAt =
      at +
      pref.family.length +
      (tokens[at + pref.family.length] === "v" ? 1 : 0);
    const rest = tokens.slice(versionAt + pref.version.length);
    if (
      !pref.version.every(
        (token, offset) => tokens[versionAt + offset] === token,
      )
    )
      return false;
    if (pref.variant === undefined)
      return rest.every((token) => stamp.test(token));
    return rest[0] === pref.variant;
  });
}

export interface ProviderListing {
  alias: string;
  listed: readonly string[];
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the model a role runs on across the providers an
 * agent holds: the list's order first, so the platform's preference beats the
 * provider order, and the providers' own order within one entry, so two
 * providers serving the same model resolve the way a default provider always
 * has. The listing's own order breaks a tie inside one provider, since a
 * provider lists its models newest first. Null when no provider lists anything
 * the list names, which leaves the caller its own last resort.
 */
export function preferredModelOf(
  role: ModelRole,
  providers: readonly ProviderListing[],
): { alias: string; upstreamId: string } | null {
  for (const pref of PREFERRED_MODELS) {
    if (pref.role !== role) continue;
    for (const provider of providers) {
      const hit = provider.listed.find((id) =>
        modelMatches(modelTokens(id), pref),
      );
      if (hit) return { alias: provider.alias, upstreamId: hit };
    }
  }
  return null;
}
