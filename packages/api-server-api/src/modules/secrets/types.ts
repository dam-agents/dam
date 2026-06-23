import type { z } from "zod";
import { ENV_NAME_RE } from "../shared.js";
import type { EnvMapping, InjectionConfig } from "../connections/providers.js";
import type {
  secretCreateGithubPatInputSchema,
  secretCreateInputSchema,
  secretUpdateGithubPatInputSchema,
  secretUpdateInputSchema,
} from "./schemas.js";

export type SecretType =
  | "anthropic"
  | "ibm-litellm"
  | "openai"
  | "bob"
  | "generic";

export function isValidEnvName(name: string): boolean {
  return name.length > 0 && ENV_NAME_RE.test(name);
}

export interface SecretView {
  id: string;
  name: string;
  type: SecretType;
  hostPattern: string;
  pathPattern?: string;
  /** Only set for generic secrets. */
  injectionConfig?: InjectionConfig;
  createdAt: string;
  envMappings?: EnvMapping[];
}

export type SecretCreateInput = z.infer<typeof secretCreateInputSchema>;
export type SecretUpdateInput = z.infer<typeof secretUpdateInputSchema>;

export interface AgentAccess {
  secretIds: string[];
}

// One PAT fans out server-side into twin `generic` secrets sharing this name (api.github.com Bearer + github.com Basic).
export type SecretCreateGithubPatInput = z.infer<
  typeof secretCreateGithubPatInputSchema
>;

export interface CreateGithubPatOutput {
  name: string;
  apiSecretId: string;
  gitSecretId: string;
}

// Replaces the token on a PAT pair by id; the github.com half's basic-auth value is re-wrapped server-side.
export type SecretUpdateGithubPatInput = z.infer<
  typeof secretUpdateGithubPatInputSchema
>;

export interface UpdateGithubPatOutput {
  apiSecretId: string;
  gitSecretId: string;
}

export interface SecretsService {
  list(): Promise<SecretView[]>;
  create(input: SecretCreateInput): Promise<SecretView>;
  createGithubPat(
    input: SecretCreateGithubPatInput,
  ): Promise<CreateGithubPatOutput>;
  updateGithubPat(
    input: SecretUpdateGithubPatInput,
  ): Promise<UpdateGithubPatOutput>;
  update(input: SecretUpdateInput): Promise<void>;
  delete(id: string): Promise<void>;
  getAgentAccess(agentId: string): Promise<AgentAccess>;
  setAgentAccess(agentId: string, access: AgentAccess): Promise<void>;
  // Expands primary secret ids to the full granted set (adds GitHub-PAT twins).
  expandSecretGrants(secretIds: string[]): Promise<string[]>;
}
