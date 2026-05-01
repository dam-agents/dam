import type { EnvVar } from "../shared.js";
import type { EgressPreset } from "../egress-rules/types.js";
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
  /** Persisted preset choice (DRAFT-unified-hitl-ux). Updating it via
   *  `agents.update` re-runs the seeder server-side: prior preset:* rows
   *  are revoked and the new preset's rows are inserted; manual and
   *  connection-derived rules are preserved. */
  egressPreset?: EgressPreset;
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
  /** Bulk-seeds egress_rules at create time. Defaults to `trusted` so a
   *  brand-new agent can reach Anthropic, npm, PyPI, GitHub, etc. without
   *  per-host inbox prompts. After seeding, rows are owned by the agent
   *  like any other rule. See DRAFT-unified-hitl-ux. */
  egressPreset?: EgressPreset;
}

export interface UpdateAgentInput {
  id: string;
  name?: string;
  description?: string;
  env?: EnvVar[];
  /** When set and different from the agent's current preset, the server
   *  reseeds preset rows alongside the spec patch. */
  egressPreset?: EgressPreset;
}

export interface AgentsService {
  list: () => Promise<Agent[]>;
  get: (id: string) => Promise<Agent | null>;
  create: (input: CreateAgentInput) => Promise<Agent>;
  update: (input: UpdateAgentInput) => Promise<Agent | null>;
  delete: (id: string) => Promise<void>;
}
