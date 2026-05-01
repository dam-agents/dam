import type { EnvVar } from "../shared.js";
import type {
  Mount,
  Resources,
  SecurityContext,
} from "../templates/types.js";

/** Env names that are managed by the platform/template and cannot be edited by users. */
export const PROTECTED_AGENT_ENV_NAMES: readonly string[] = ["PORT"];

export function isProtectedAgentEnvName(name: string): boolean {
  return PROTECTED_AGENT_ENV_NAMES.includes(name);
}

export interface AgentSpec {
  version: string;
  name: string;
  // Copied from template at creation:
  image: string;
  description?: string;
  mounts?: Mount[];
  init?: string;
  env?: EnvVar[];
  resources?: Resources;
  securityContext?: SecurityContext;
  skillPaths?: string[];
}

export interface Agent {
  id: string;
  name: string;
  templateId?: string;
  spec: AgentSpec;
}

export interface CreateAgentInput {
  name: string;
  templateId?: string;
  image?: string;
  description?: string;
  env?: EnvVar[];
}

export interface UpdateAgentInput {
  id: string;
  name?: string;
  description?: string;
  env?: EnvVar[];
}

export interface AgentsService {
  list: () => Promise<Agent[]>;
  get: (id: string) => Promise<Agent | null>;
  create: (input: CreateAgentInput) => Promise<Agent>;
  update: (input: UpdateAgentInput) => Promise<Agent | null>;
  delete: (id: string) => Promise<void>;
}
