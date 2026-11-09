/**
 * UNIT_BOUNDARY_DESCRIPTION: the platform's own taste in models, one ordered
 * list per role, because a provider's Connection says which models it serves
 * and never which of them to prefer. A routed harness never sees a preset's
 * env, so nothing else names the classifier's model, and a provider whose ids
 * carry no tier word (CurveBender, the built-in one) has no tier to guess
 * from: an agent that picked no model would run on the newest id the provider
 * happens to list, and a classifier call on the session's own work model.
 *
 * Entries are read in three groups: the harness's own, then those that name
 * no harness, then another harness's. So the `work` list reads: the harness's
 * own models where a granted provider serves them — Claude Code Claude Opus,
 * Codex GPT, Gemini CLI Gemini, Bob Bob's fast then explorer — then DeepSeek
 * V4.1 Flash, which every install serves, and then the models of the other
 * harnesses, which answer only where a listing holds nothing the first two
 * groups name. An agent runs on the models its harness was built for; a
 * harness that names no model of its own, such as Pi or Hermes, takes
 * DeepSeek, and another harness's model only where no provider lists DeepSeek.
 * `work` decides a new agent's default model and the model a default with
 * none runs on, `classifier` what Claude Code's non-reasoning permission
 * classifier runs on, which is the same on every harness. The order is the
 * preference: the first entry a listing answers wins. Bob's own gateway lists
 * only Bob's names, so those two answer only on the provider `alias` names,
 * since their plain words are other providers' models too (`grok-4-fast`).
 * `family` is the model's words, `version` the digits right behind them and
 * `variant` the word right behind those, all as tokens of `modelTokens`.
 */
export type ModelRole = "work" | "classifier";

export interface PreferredModel {
  role: ModelRole;
  harness?: string;
  family: readonly string[];
  version: readonly string[];
  variant?: string;
  alias?: string;
}

export const PREFERRED_MODELS: readonly PreferredModel[] = [
  {
    role: "work",
    harness: "claude-code",
    family: ["claude", "opus"],
    version: ["5", "5"],
  },
  {
    role: "work",
    harness: "codex",
    family: ["gpt"],
    version: ["6", "1"],
    variant: "sol",
  },
  {
    role: "work",
    harness: "gemini-cli",
    family: ["gemini"],
    version: ["3", "1"],
    variant: "pro",
  },
  { role: "work", harness: "bob", family: ["fast"], version: [], alias: "bob" },
  {
    role: "work",
    harness: "bob",
    family: ["explorer"],
    version: [],
    alias: "bob",
  },
  { role: "work", family: ["deepseek"], version: ["4", "1"], variant: "flash" },
  {
    role: "classifier",
    family: ["nemotron"],
    version: ["3"],
    variant: "ultra",
  },
  { role: "classifier", family: ["claude", "sonnet"], version: ["5"] },
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
 * on it unseen. A version that goes on past the listed digits is that other
 * version too: Sonnet 5.5 is not the Sonnet 5 the list names. What may still
 * follow is the build stamp providers append (`-1017`, `-20260101`), three
 * digits or more — a version's own digits come one or two at a time, so a
 * shorter number after the version continues it — and a word there is a
 * variant.
 */
export function modelMatches(
  tokens: readonly string[],
  pref: PreferredModel,
): boolean {
  const stamp = /^\d{3,}$/;
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
 * agent holds, for the harness its runs use: the list's order first, so the
 * platform's preference beats the provider order, and the providers' own order
 * within one entry, so two providers serving the same model resolve the way a
 * default provider always has. The harness's own entries are read before the
 * harness-agnostic ones, which are read before another harness's, so a Claude
 * Code agent gets Claude where a provider serves it, then DeepSeek, and never
 * another harness's model ahead of them; a caller that names no harness reads
 * the harness-agnostic entries first, as an unrouted image's own harness and a
 * catalogue lookup do. The listing's own order breaks a tie inside one
 * provider, since a provider lists its models newest first. Null when no
 * provider lists anything the list answers with, which leaves the caller its
 * own last resort.
 */
export function preferredModelOf(
  role: ModelRole,
  providers: readonly ProviderListing[],
  harness?: string,
): { alias: string; upstreamId: string } | null {
  const groupOf = (pref: PreferredModel): number =>
    pref.harness === undefined ? 1 : pref.harness === harness ? 0 : 2;
  const ranked = PREFERRED_MODELS.filter((pref) => pref.role === role).sort(
    (a, b) => groupOf(a) - groupOf(b),
  );
  for (const pref of ranked) {
    for (const provider of providers) {
      if (pref.alias !== undefined && pref.alias !== provider.alias) continue;
      const hit = provider.listed.find((id) =>
        modelMatches(modelTokens(id), pref),
      );
      if (hit) return { alias: provider.alias, upstreamId: hit };
    }
  }
  return null;
}
