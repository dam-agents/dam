import type { z } from "zod";
import type { EnvVar } from "../shared.js";
import type { harnessFamilySchema } from "./schemas.js";

export interface Mount {
  path: string;
  persist: boolean;
}

export interface Resources {
  requests?: Record<string, string>;
  limits?: Record<string, string>;
}

export const SPEC_VERSION = "platform/v1";

export type TemplateCategory = "harness" | "preconfigured";

export type HarnessFamily = z.infer<typeof harnessFamilySchema>;

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
  harness?: HarnessFamily;
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
  hibernationTimeout?: string;
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
