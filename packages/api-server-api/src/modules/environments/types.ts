import type { z } from "zod";
import type {
  agentEnvironmentViewSchema,
  environmentEndpointSchema,
  environmentViewSchema,
} from "./schemas.js";

export type EnvironmentEndpoint = z.infer<typeof environmentEndpointSchema>;
export type EnvironmentView = z.infer<typeof environmentViewSchema>;
export type AgentEnvironmentView = z.infer<typeof agentEnvironmentViewSchema>;

export interface EnvironmentsService {
  list(owningAgentId: string): Promise<EnvironmentView[]>;
  listAll(): Promise<EnvironmentView[]>;
  agentMembers(owningAgentId: string): Promise<string[]>;
  setAgentMembers(owningAgentId: string, emails: string[]): Promise<string[]>;
  setMembers(id: string, emails: string[]): Promise<EnvironmentView>;
  extend(id: string, expiresAt: Date): Promise<EnvironmentView>;
  delete(id: string): Promise<void>;
}
