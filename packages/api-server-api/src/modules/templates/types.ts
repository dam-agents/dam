import type { EnvVar } from "../shared.js";

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

export type TemplateCategory = "harness" | "preconfigured";

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
  backend?: { type: "container" | "vm"; vm?: Record<string, unknown> };
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
