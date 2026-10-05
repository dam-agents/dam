import type { z } from "zod";
import type { ProviderPresetType } from "../connections/providers.js";
import type { EnvVar } from "../shared.js";
import type { harnessFamilySchema, templateHarnessSchema } from "./schemas.js";

export interface Mount {
  path: string;
  persist: boolean;
  size?: string;
}

export interface Resources {
  requests?: Record<string, string>;
  limits?: Record<string, string>;
}

export const SPEC_VERSION = "agent-platform.ai/v1";

export type TemplateCategory = "harness";

export type HarnessFamily = z.infer<typeof harnessFamilySchema>;

export type TemplateHarness = z.infer<typeof templateHarnessSchema>;

export interface SkillSourceSeed {
  name: string;
  gitUrl: string;
  path?: string;
}

export interface TemplateSpec {
  version: string;
  image: string;
  name?: string;
  description?: string;
  category?: TemplateCategory;
  harness?: TemplateHarness;
  providers?: ProviderPresetType[];
  tags?: string[];
  docsUrl?: string;
  releaseNotesUrl?: string;
  setupNote?: { title: string; body: string };
  experimental?: boolean;
  mounts?: Mount[];
  init?: string;
  env?: EnvVar[];
  resources?: Resources;
  imagePullPolicy?: string;
  imagePullSecretRef?: string;
  hibernationTimeout?: string;
  storageSize?: string;
  storageClass?: string;
  runtimeClassName?: string;
  nodeSelector?: Record<string, string>;
  skillSources?: SkillSourceSeed[];
}

export interface Template {
  id: string;
  name: string;
  spec: TemplateSpec;
}

export interface TemplatesService {
  list: () => Promise<Template[]>;
  get: (id: string) => Promise<Template | null>;
}
