import type { z } from "zod";
import type {
  environmentEndpointSchema,
  environmentViewSchema,
} from "./schemas.js";

export type EnvironmentEndpoint = z.infer<typeof environmentEndpointSchema>;
export type EnvironmentView = z.infer<typeof environmentViewSchema>;

export interface EnvironmentsService {
  list(owningAgentId: string): Promise<EnvironmentView[]>;
  accessList(owningAgentId: string): Promise<string[]>;
  setAccessList(owningAgentId: string, emails: string[]): Promise<string[]>;
  extend(id: string, expiresAt: Date): Promise<EnvironmentView>;
  delete(id: string): Promise<void>;
}
