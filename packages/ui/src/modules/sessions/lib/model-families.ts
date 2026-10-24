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
  snapshotDate?: string;
}

const SNAPSHOT = /^\d{8}$/;
const VERSION_PART = /^\d{1,2}$/;

/**
 * UNIT_BOUNDARY_DESCRIPTION: gateways prefix a model id with their own path
 * (`ibm/aws/…`) and Bedrock with dots (`eu.anthropic.…`), so only the last
 * path segment is read, and a name is a family model only when it is one of
 * the shapes builders publish: `claude-opus-5-5`, `claude-3-5-sonnet` and
 * `gpt-6.1-sol`, with 1–2 version parts and an optional snapshot date after
 * them. Any other token (a variant such as `-mini`) leaves the name out, so
 * it stays a distinct model instead of merging with the model it resembles.
 */
export function parseModelFamily(name: string): ParsedModel | null {
  const tokens = (name.toLowerCase().split("/").pop() ?? "").split(
    /[^a-z0-9]+/,
  );
  for (const family of MODEL_FAMILIES) {
    const at = tokens.indexOf(family.token);
    if (at < 0) continue;
    const after = tokens.slice(at + 1);
    const last = after[after.length - 1];
    const snapshotDate =
      after.length > 1 && last !== undefined && SNAPSHOT.test(last)
        ? last
        : undefined;
    const rest = snapshotDate === undefined ? after : after.slice(0, -1);
    for (const size of family.sizes) {
      if (rest.length < 2 || rest.length > 3) continue;
      const versionOf = (parts: readonly string[]) =>
        parts.every((p) => VERSION_PART.test(p)) ? parts.map(Number) : null;
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
          ...(snapshotDate !== undefined && { snapshotDate }),
        };
    }
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
 * ones kept, and so has a name another name of the same provider already
 * represents (a snapshot of the same version), so no selectable name is lost;
 * a provider that listed none is kept for its listing state.
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
          label: `${parsed.size.charAt(0).toUpperCase()}${parsed.size.slice(1)} ${parsed.version.join(".")}`,
          options: [],
        };
        known.set(key, entry);
      }
      if (
        entry.options.some((o) => o.group.connectionId === group.connectionId)
      ) {
        unknown.push(model);
        continue;
      }
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
