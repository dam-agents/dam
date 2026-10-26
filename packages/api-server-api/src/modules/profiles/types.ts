import type { z } from "zod";
import type {
  profileCreateInputSchema,
  profileListInputSchema,
  profileUpdateInputSchema,
  profileUsageSchema,
  profileViewSchema,
} from "./schemas.js";

export type ProfileCreateInput = z.infer<typeof profileCreateInputSchema>;
export type ProfileUpdateInput = z.infer<typeof profileUpdateInputSchema>;
export type ProfileUsage = z.infer<typeof profileUsageSchema>;
export type ProfileWithUsage = z.infer<typeof profileViewSchema>;

export interface ProfilesService {
  list(
    input?: z.infer<typeof profileListInputSchema>,
  ): Promise<ProfileWithUsage[]>;
  usage(id: string): Promise<ProfileUsage>;
  create(input: ProfileCreateInput): Promise<ProfileWithUsage>;
  update(input: ProfileUpdateInput): Promise<ProfileWithUsage>;
  /** UNIT_BOUNDARY_DESCRIPTION: makes the profile the owner's one default for new agents. */
  setDefault(id: string): Promise<void>;
  delete(id: string): Promise<void>;
}
