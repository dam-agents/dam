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

export type TemplateCategory = "harness" | "preconfigured";

/** A {name, gitUrl} pair declared by the helm values (platform-wide) or by a
 *  template (per-agent). The same shape flows through every layer — helm
 *  values, rendered ConfigMap, TypeScript and Go types. */
export interface SkillSourceSeed {
  name: string;
  gitUrl: string;
  path?: string;
}

// An agent template's spec.yaml carries Layer B + C fields.
// Layer A (security context, scheduling, cluster details) is chart-only and
// intentionally absent from this surface — operators set it via Helm values.
export interface TemplateSpec {
  version: string;
  image: string;
  description?: string;
  category?: TemplateCategory;
  experimental?: boolean;
  mounts?: Mount[];
  init?: string;
  env?: EnvVar[];
  resources?: Resources;
  /** Overrides `controller.agent.templateDefaults.imagePullPolicy` for
   *  instances created from this template. Empty = inherit. */
  imagePullPolicy?: string;
  /** Names a kubernetes.io/dockerconfigjson Secret in the agent namespace,
   *  pre-created by the chart for templates pulling from a private registry.
   *  Carried onto the agent spec so the pod pulls without the user supplying
   *  registry credentials. Empty = none. */
  imagePullSecretRef?: string;
  /** Overrides `controller.agent.templateDefaults.storageSize` for the
   *  persistent home mount. Per-mount `size` (if set) wins over this. */
  storageSize?: string;
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
