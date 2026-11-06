import type { z } from "zod";
import type {
  agentEnvironmentMembersViewSchema,
  agentEnvironmentViewSchema,
  environmentAgentLookupSchema,
  environmentEndpointSchema,
  environmentMemberAgentSchema,
  environmentViewSchema,
  sharedEnvironmentViewSchema,
} from "./schemas.js";

export type EnvironmentEndpoint = z.infer<typeof environmentEndpointSchema>;
export type EnvironmentView = z.infer<typeof environmentViewSchema>;
export type AgentEnvironmentView = z.infer<typeof agentEnvironmentViewSchema>;
export type SharedEnvironmentView = z.infer<typeof sharedEnvironmentViewSchema>;
export type EnvironmentMemberAgent = z.infer<
  typeof environmentMemberAgentSchema
>;
export type AgentEnvironmentMembersView = z.infer<
  typeof agentEnvironmentMembersViewSchema
>;
export type EnvironmentAgentLookup = z.infer<
  typeof environmentAgentLookupSchema
>;

// UNIT_BOUNDARY_DESCRIPTION: a replacement list: its people, and its Agents when given; an omitted Agent list keeps the Agents it has, for a client that only knows people.
export interface MembersUpdate {
  emails: string[];
  agentIds?: string[];
}

export interface EnvironmentsService {
  list(owningAgentId: string): Promise<EnvironmentView[]>;
  listAll(): Promise<EnvironmentView[]>;
  agentMembers(owningAgentId: string): Promise<AgentEnvironmentMembersView>;
  setAgentMembers(
    owningAgentId: string,
    update: MembersUpdate,
  ): Promise<AgentEnvironmentMembersView>;
  setMembers(id: string, update: MembersUpdate): Promise<EnvironmentView>;
  lookupAgent(agentId: string): Promise<EnvironmentAgentLookup>;
  extend(id: string, expiresAt: Date | "never"): Promise<EnvironmentView>;
  setAwake(id: string, awake: boolean): Promise<EnvironmentView>;
  delete(id: string): Promise<void>;
}
