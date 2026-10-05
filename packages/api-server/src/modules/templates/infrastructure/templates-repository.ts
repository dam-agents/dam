import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadYamlDocument } from "../../../core/yaml-document.js";
import type { Template, TemplateSpec, TemplatesService } from "api-server-api";
import { templateSpecSchema } from "api-server-api";

export interface TemplatesRepository {
  list(): Promise<Template[]>;
  get(id: string): Promise<Template | null>;
  readSpec(id: string): Promise<{ spec: TemplateSpec } | null>;
}

export type ReadTemplateSpec = TemplatesRepository["readSpec"];

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
      return tmpl ? { spec: tmpl.spec } : null;
    },
  };
}

// UNIT_BOUNDARY_DESCRIPTION: the templates a user is offered on this install. A template that declares the vm backend boots a bare image whose tools only a microVM mounts, so on an install without virtualization it is left out of the list and reads as absent, like a vm Starter Kit. Create, upgrade and skills keep reading the full repository, so the create refusal for a microVM stays the one gate and an existing agent keeps its template's skill sources.
export function runnableTemplates(
  repo: TemplatesService,
  virtualizationEnabled: boolean,
): TemplatesService {
  if (virtualizationEnabled) return repo;
  const runnable = (t: Template) => t.spec.backend !== "vm";
  return {
    list: async () => (await repo.list()).filter(runnable),
    get: async (id) => {
      const t = await repo.get(id);
      return t && runnable(t) ? t : null;
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
    if (entry.startsWith(".") || !entry.endsWith(".yaml")) continue;
    const id = entry.slice(0, -".yaml".length);
    try {
      const spec = templateSpecSchema.parse(
        loadYamlDocument(readFileSync(join(dir, entry), "utf8")),
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
