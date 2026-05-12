import type { EnvVar } from "../shared.js";

export interface Mount {
  path: string;
  persist: boolean;
  /** Optional per-mount PVC size (K8s resource Quantity, e.g. "5Gi"). When
   *  empty, falls back to TemplateSpec.storageSize, then to the chart-wide
   *  `controller.agent.templateDefaults.storageSize`. */
  size?: string;
}

export interface Resources {
  requests?: Record<string, string>;
  limits?: Record<string, string>;
}

export const SPEC_VERSION = "agent-platform.ai/v1";

/** A {name, gitUrl} pair declared by the helm values (platform-wide) or by a
 *  template (per-agent). The same shape flows through every layer — helm
 *  values, rendered ConfigMap, TypeScript and Go types. */
export interface SkillSourceSeed {
  name: string;
  gitUrl: string;
}

// Per ADR-042, an agent template's spec.yaml carries Layer B + C fields.
// Layer A (security context, scheduling, cluster details) is chart-only and
// intentionally absent from this surface — operators set it via Helm values.
export interface TemplateSpec {
  version: string;
  image: string;
  description?: string;
  mounts?: Mount[];
  init?: string;
  env?: EnvVar[];
  resources?: Resources;
  /** Overrides `controller.agent.templateDefaults.imagePullPolicy` for
   *  instances created from this template. Empty = inherit. */
  imagePullPolicy?: string;
  /** Overrides `controller.agent.templateDefaults.storageSize` for the
   *  persistent home mount. Per-mount `size` (if set) wins over this. */
  storageSize?: string;
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
