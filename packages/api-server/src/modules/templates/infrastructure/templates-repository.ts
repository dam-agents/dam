import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import type { Template, TemplateSpec } from "api-server-api";
import { templateSpecSchema } from "api-server-api";

export interface TemplatesRepository {
  list(): Promise<Template[]>;
  get(id: string): Promise<Template | null>;
  readSpec(
    id: string,
  ): Promise<{ spec: TemplateSpec; isOwned: boolean } | null>;
}

/**
 * Templates are chart-shipped config mounted as `<id>.yaml` files;
 * they change only on helm upgrade (which restarts the pod), so load them once
 * at construction rather than per-request. No user-owned templates (isOwned is
 * always false); an empty/missing `dir` yields an empty catalogue.
 */
export function createTemplatesRepository(dir: string): TemplatesRepository {
  const byId = loadTemplates(dir);
  return {
    async list() {
      return [...byId.values()];
    },
    async get(id) {
      return byId.get(id) ?? null;
    },
    async readSpec(id) {
      const tmpl = byId.get(id);
      return tmpl ? { spec: tmpl.spec, isOwned: false } : null;
    },
  };
}

function loadTemplates(dir: string): Map<string, Template> {
  const byId = new Map<string, Template>();
  if (!dir) return byId;

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (err) {
    process.stderr.write(
      `agent-templates: ${dir}: ${err instanceof Error ? err.message : err}\n`,
    );
    return byId;
  }

  for (const entry of entries) {
    // ConfigMap volume mounts surface data keys alongside `..data` symlinks
    // and timestamped dirs; skip those and anything that isn't a template.
    if (entry.startsWith(".") || !entry.endsWith(".yaml")) continue;
    const id = entry.slice(0, -".yaml".length);
    try {
      const spec = templateSpecSchema.parse(
        yaml.load(readFileSync(join(dir, entry), "utf8")),
      );
      byId.set(id, { id, name: spec.name ?? id, spec });
    } catch (err) {
      process.stderr.write(
        `agent-templates: skipping ${entry}: ${err instanceof Error ? err.message : err}\n`,
      );
    }
  }
  return byId;
}
