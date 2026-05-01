import type { EnvVar } from "../shared.js";

export interface Mount {
  path: string;
  persist: boolean;
}

export interface Resources {
  requests?: Record<string, string>;
  limits?: Record<string, string>;
}

export interface SecurityContext {
  runAsNonRoot?: boolean;
  readOnlyRootFilesystem?: boolean;
}

export const SPEC_VERSION = "humr.ai/v1";

/** A {name, gitUrl} pair declared by the helm values (platform-wide) or by a
 *  template (per-agent). The same shape flows through every layer — helm
 *  values, rendered ConfigMap, TypeScript and Go types. */
export interface SkillSourceSeed {
  name: string;
  gitUrl: string;
}

export interface TemplateSpec {
  version: string;
  image: string;
  description?: string;
  mounts?: Mount[];
  init?: string;
  env?: EnvVar[];
  resources?: Resources;
  securityContext?: SecurityContext;
  /** Filesystem paths the harness reads skills from. Copied onto the agent
   *  spec at creation time so the skills-service knows where to install. */
  skillPaths?: string[];
  /** Template-declared skill sources surfaced in the Skills panel of every
   *  instance derived from this template. Read-only; badged as "Agent". */
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
