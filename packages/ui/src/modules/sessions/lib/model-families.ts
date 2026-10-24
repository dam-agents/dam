import type { CatalogModelView } from "agent-runtime-api";

import type { ModelGroup } from "./catalog-groups.js";

export interface ModelFamily {
  name: string;
  token: string;
  sizes: readonly string[];
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the families and their size tiers, smallest to
 * largest, which is what makes a size one menu entry and orders it; a new
 * size is one string here, in that order. A family whose ids carry no size
 * word has no tiers, so it reads as one tier of its own.
 */
export const MODEL_FAMILIES: readonly ModelFamily[] = [
  {
    name: "Claude",
    token: "claude",
    sizes: ["haiku", "sonnet", "opus", "fable", "mythos"],
  },
  {
    name: "GPT",
    token: "gpt",
    sizes: ["luna", "terra", "sol", "astra"],
  },
  {
    name: "GLM",
    token: "glm",
    sizes: [],
  },
  {
    name: "DeepSeek",
    token: "deepseek",
    sizes: ["flash"],
  },
];

export interface ParsedModel {
  family: ModelFamily;
  size: string;
  version: readonly number[];
  buildStamp?: string;
}

const BUILD_STAMP = /^\d{4,8}$/;
const VERSION_PART = /^v?\d{1,2}$/;

/**
 * UNIT_BOUNDARY_DESCRIPTION: gateways prefix a model id with their own path
 * (`ibm/aws/…`) and Bedrock with dots (`eu.anthropic.…`), so only the last
 * path segment is read.
 */
const tokensOf = (name: string) =>
  (name.toLowerCase().split("/").pop() ?? "").split(/[^a-z0-9]+/);

const familyOf = (tokens: readonly string[]): ModelFamily | null =>
  MODEL_FAMILIES.find((family) => tokens.includes(family.token)) ?? null;

/**
 * UNIT_BOUNDARY_DESCRIPTION: a name is a family model only in one of the
 * shapes builders publish: `claude-opus-5-5`, `claude-3-5-sonnet` and
 * `gpt-6.1-sol`, with 1–2 version parts and an optional build stamp after
 * them, or, for a family with no size word, the version parts alone; a
 * version may carry the `v` marker (`DeepSeek-V4.1-Flash`). Any other token
 * (a variant such as `-mini`, a size in the middle) leaves it out, so it
 * stays a distinct model instead of merging with the model it resembles.
 * The stamp, a snapshot date or a build number, stays apart from the
 * version, so a stamped snapshot is the same model.
 */
export function parseModelFamily(name: string): ParsedModel | null {
  const tokens = tokensOf(name);
  const family = familyOf(tokens);
  if (family === null) return null;
  const after = tokens.slice(tokens.indexOf(family.token) + 1);
  const last = after[after.length - 1];
  const buildStamp =
    after.length > 1 && last !== undefined && BUILD_STAMP.test(last)
      ? last
      : undefined;
  const rest = buildStamp === undefined ? after : after.slice(0, -1);
  const versionOf = (parts: readonly string[]) =>
    parts.every((p) => VERSION_PART.test(p))
      ? parts.map((p) => Number(p.replace(/^v/, "")))
      : null;
  if (family.sizes.length === 0) {
    if (rest.length < 1 || rest.length > 2) return null;
    const version = versionOf(rest);
    return version === null
      ? null
      : {
          family,
          size: family.token,
          version,
          ...(buildStamp !== undefined && { buildStamp }),
        };
  }
  for (const size of family.sizes) {
    if (rest.length < 2 || rest.length > 3) continue;
    const version =
      rest[0] === size
        ? versionOf(rest.slice(1))
        : rest[rest.length - 1] === size
          ? versionOf(rest.slice(0, -1))
          : null;
    if (version !== null)
      return {
        family,
        size,
        version,
        ...(buildStamp !== undefined && { buildStamp }),
      };
  }
  return null;
}

export function compareVersions(
  a: readonly number[],
  b: readonly number[],
): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export interface ModelOption {
  group: ModelGroup;
  model: CatalogModelView;
}

export interface MenuEntry {
  key: string;
  label: string;
  options: ModelOption[];
}

export interface FamilyModel extends ParsedModel, MenuEntry {}

export interface FamilySection {
  family: ModelFamily;
  newest: FamilyModel[];
  more: MenuEntry[];
  expanded: MenuEntry[];
}

export interface OtherSection {
  models: MenuEntry[];
  unlisted: ModelGroup[];
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: one entry per size tier holding the newest
 * version any provider lists, one option per provider offering that version;
 * collapsed it lists those by size, largest first, and open it lists every
 * entry by version newest first, then by size largest first. Older versions
 * and models of a known family whose size or variant is not recognised sit
 * behind that family's More; a model of no known family is one entry under
 * Other. A name another name of the same provider already represents stays
 * an entry of its own there, so no selectable name is lost. A provider that
 * listed nothing is kept for its listing state.
 */
export function familyModelGroups(groups: readonly ModelGroup[]): {
  families: FamilySection[];
  other: OtherSection;
} {
  const recognized = new Map<string, FamilyModel>();
  const loose = new Map<
    string,
    { family: ModelFamily | null; entry: MenuEntry }
  >();
  const unlisted: ModelGroup[] = [];
  const addLoose = (
    family: ModelFamily | null,
    group: ModelGroup,
    model: CatalogModelView,
  ) => {
    const key = `${family?.token ?? "other"}/${model.upstreamId.toLowerCase()}`;
    let found = loose.get(key);
    if (found === undefined) {
      found = {
        family,
        entry: { key, label: model.upstreamId, options: [] },
      };
      loose.set(key, found);
    }
    if (
      !found.entry.options.some(
        (o) => o.group.connectionId === group.connectionId,
      )
    )
      found.entry.options.push({ group, model });
  };
  for (const group of groups) {
    if (group.models.length === 0) {
      unlisted.push(group);
      continue;
    }
    for (const model of group.models) {
      const family = familyOf(tokensOf(model.name));
      const parsed = family === null ? null : parseModelFamily(model.name);
      if (parsed === null) {
        addLoose(family, group, model);
        continue;
      }
      const key = `${parsed.family.token}/${parsed.size}/${parsed.version.join(".")}`;
      let entry = recognized.get(key);
      if (entry === undefined) {
        entry = {
          ...parsed,
          key,
          label:
            parsed.family.sizes.length === 0
              ? parsed.version.join(".")
              : `${parsed.size.charAt(0).toUpperCase()}${parsed.size.slice(1)} ${parsed.version.join(".")}`,
          options: [],
        };
        recognized.set(key, entry);
      }
      if (
        entry.options.some((o) => o.group.connectionId === group.connectionId)
      ) {
        addLoose(family, group, model);
        continue;
      }
      entry.options.push({ group, model });
    }
  }
  const families = MODEL_FAMILIES.map((family) => {
    const versioned = [...recognized.values()]
      .filter((e) => e.family === family)
      .sort(
        (a, b) =>
          compareVersions(b.version, a.version) ||
          family.sizes.indexOf(b.size) - family.sizes.indexOf(a.size),
      );
    const newest: FamilyModel[] = [];
    const sizes =
      family.sizes.length === 0 ? [family.token] : [...family.sizes].reverse();
    for (const size of sizes) {
      const entry = versioned.find((e) => e.size === size);
      if (entry !== undefined) newest.push(entry);
    }
    const variants = [...loose.values()]
      .filter((l) => l.family?.token === family.token)
      .map((l) => l.entry);
    return {
      family,
      newest,
      more: [...versioned.filter((e) => !newest.includes(e)), ...variants],
      expanded: [...versioned, ...variants],
    };
  }).filter((section) => section.newest.length > 0 || section.more.length > 0);
  return {
    families,
    other: {
      models: [...loose.values()]
        .filter((l) => l.family === null)
        .map((l) => l.entry),
      unlisted,
    },
  };
}
