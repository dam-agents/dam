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
 * size is one string here, in that order.
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
];

export interface ParsedModel {
  family: ModelFamily;
  size: string;
  version: readonly number[];
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: gateways prefix a model id with their own path
 * (`ibm/aws/…`) and Bedrock with dots (`eu.anthropic.…`), so only the last
 * path segment is read, and its family, size and version tokens are found
 * wherever they sit in it; a name without a known size is not a family model.
 */
export function parseModelFamily(name: string): ParsedModel | null {
  const tokens = (name.toLowerCase().split("/").pop() ?? "").split(
    /[^a-z0-9]+/,
  );
  for (const family of MODEL_FAMILIES) {
    const at = tokens.indexOf(family.token);
    if (at < 0) continue;
    const rest = tokens.slice(at + 1);
    const size = rest.find((t) => family.sizes.includes(t));
    if (size === undefined) continue;
    const version = rest.filter((t) => /^\d+$/.test(t)).map(Number);
    return { family, size, version };
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

export interface FamilyModel extends ParsedModel {
  key: string;
  label: string;
  options: ModelOption[];
}

export interface FamilySection {
  family: ModelFamily;
  newest: FamilyModel[];
  older: FamilyModel[];
}

export interface LeftoverModels {
  group: ModelGroup;
  models: CatalogModelView[];
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: one entry per size tier holding the newest
 * version any provider lists, one option per provider offering that version;
 * older versions and models of no known family are left for the menu to hide
 * behind More and list last. A provider that listed models has its unknown
 * ones kept; a provider that listed none is kept for its listing state.
 */
export function familyModelGroups(groups: readonly ModelGroup[]): {
  families: FamilySection[];
  leftovers: LeftoverModels[];
} {
  const known = new Map<string, FamilyModel>();
  const leftovers: LeftoverModels[] = [];
  for (const group of groups) {
    const unknown: CatalogModelView[] = [];
    for (const model of group.models) {
      const parsed = parseModelFamily(model.name);
      if (parsed === null) {
        unknown.push(model);
        continue;
      }
      const key = `${parsed.family.token}/${parsed.size}/${parsed.version.join(".")}`;
      let entry = known.get(key);
      if (entry === undefined) {
        entry = {
          ...parsed,
          key,
          label: `${parsed.size.charAt(0).toUpperCase()}${parsed.size.slice(1)}${parsed.version.length > 0 ? ` ${parsed.version.join(".")}` : ""}`,
          options: [],
        };
        known.set(key, entry);
      }
      if (
        !entry.options.some((o) => o.group.connectionId === group.connectionId)
      )
        entry.options.push({ group, model });
    }
    if (unknown.length > 0 || group.models.length === 0)
      leftovers.push({ group, models: unknown });
  }
  const families = MODEL_FAMILIES.map((family) => {
    const entries = [...known.values()].filter((e) => e.family === family);
    const newest: FamilyModel[] = [];
    const older: FamilyModel[] = [];
    for (const size of [...family.sizes].reverse()) {
      entries
        .filter((e) => e.size === size)
        .sort((a, b) => compareVersions(b.version, a.version))
        .forEach((entry, index) => {
          (index === 0 ? newest : older).push(entry);
        });
    }
    return { family, newest, older };
  }).filter((section) => section.newest.length > 0);
  return { families, leftovers };
}
