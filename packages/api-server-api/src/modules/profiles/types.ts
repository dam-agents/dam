import type { z } from "zod";
import type {
  newAgentDefaultSchema,
  profileCreateInputSchema,
  profileListInputSchema,
  profileUpdateInputSchema,
  profileUsageSchema,
  profileViewSchema,
  setNewAgentDefaultInputSchema,
} from "./schemas.js";

export type ProfileCreateInput = z.infer<typeof profileCreateInputSchema>;
export type ProfileUpdateInput = z.infer<typeof profileUpdateInputSchema>;
export type ProfileUsage = z.infer<typeof profileUsageSchema>;
export type ProfileWithUsage = z.infer<typeof profileViewSchema>;
export type NewAgentDefaultView = z.infer<typeof newAgentDefaultSchema>;

export interface ProfilesService {
  list(
    input?: z.infer<typeof profileListInputSchema>,
  ): Promise<ProfileWithUsage[]>;
  usage(id: string): Promise<ProfileUsage>;
  create(input: ProfileCreateInput): Promise<ProfileWithUsage>;
  update(input: ProfileUpdateInput): Promise<ProfileWithUsage>;
  newAgentDefault(): Promise<NewAgentDefaultView>;
  setNewAgentDefault(
    input: z.infer<typeof setNewAgentDefaultInputSchema>,
  ): Promise<void>;
  delete(id: string): Promise<void>;
}
