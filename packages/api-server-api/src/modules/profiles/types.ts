import type { SessionSettings } from "agent-runtime-api";
import type { z } from "zod";
import type {
  profileCreateInputSchema,
  profileUpdateResultSchema,
  profileSlotSchema,
  profileUpdateInputSchema,
  profileUsageCountsSchema,
  profileUsageSchema,
  profileViewSchema,
} from "./schemas.js";

export type ProfileSlot = z.infer<typeof profileSlotSchema>;

export type ProfileCreateInput = z.infer<typeof profileCreateInputSchema>;
export type ProfileUpdateInput = z.infer<typeof profileUpdateInputSchema>;

export interface ProfileView {
  id: string;
  name: string;
  harness: string;
  providerTemplate: string;
  model: string;
  settings: SessionSettings;
  seeded: boolean;
  createdAt: string;
  updatedAt: string;
}

/** UNIT_BOUNDARY_DESCRIPTION: what points at a profile, so deleting one can say what stops instead of silently rewriting it. */
export type ProfileUsage = z.infer<typeof profileUsageSchema>;

export type ProfileUsageCounts = z.infer<typeof profileUsageCountsSchema>;

export type ProfileWithUsage = z.infer<typeof profileViewSchema>;

export type ProfileUpdateResult = z.infer<typeof profileUpdateResultSchema>;

export interface ProfilesService {
  list(): Promise<ProfileWithUsage[]>;
  usage(id: string): Promise<ProfileUsage>;
  create(input: ProfileCreateInput): Promise<ProfileWithUsage>;
  update(input: ProfileUpdateInput): Promise<ProfileUpdateResult>;
  delete(id: string): Promise<void>;
}

/** UNIT_BOUNDARY_DESCRIPTION: why a stored profile reference cannot run for an agent, in the words a picker shows. */
export type ProfileUnavailableReason =
  | "not-owned"
  | "no-provider"
  | "rival-provider"
  | "harness-not-carried"
  | "model-not-listed";
