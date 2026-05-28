import type { z } from "zod";
import type {
  localSkillSchema,
  skillCreateSourceInputSchema,
  skillInstallInputSchema,
  skillPublishInputSchema,
  skillPublishRecordSchema,
  skillPublishResultSchema,
  skillRefSchema,
  skillSchema,
  skillSourceSchema,
  skillStateOutputSchema,
  skillUninstallInputSchema,
} from "./schemas.js";

export type SkillRef = z.infer<typeof skillRefSchema>;
export type SkillSource = z.infer<typeof skillSourceSchema>;
export type Skill = z.infer<typeof skillSchema>;
export type LocalSkill = z.infer<typeof localSkillSchema>;

export type SkillCreateSourceInput = z.infer<
  typeof skillCreateSourceInputSchema
>;

export type SkillInstallInput = z.infer<typeof skillInstallInputSchema>;

export type SkillUninstallInput = z.infer<typeof skillUninstallInputSchema>;

export type SkillPublishInput = z.infer<typeof skillPublishInputSchema>;

export type SkillPublishResult = z.infer<typeof skillPublishResultSchema>;

export type SkillPublishRecord = z.infer<typeof skillPublishRecordSchema>;

export type SkillsState = z.infer<typeof skillStateOutputSchema>;

export interface SkillsService {
  listSources: (agentId?: string) => Promise<SkillSource[]>;
  getSource: (id: string) => Promise<SkillSource | null>;
  createSource: (input: SkillCreateSourceInput) => Promise<SkillSource>;
  deleteSource: (id: string) => Promise<void>;
  refreshSource: (id: string) => Promise<void>;
  list: (sourceId: string, agentId?: string) => Promise<Skill[]>;
  install: (input: SkillInstallInput) => Promise<SkillRef[]>;
  uninstall: (input: SkillUninstallInput) => Promise<SkillRef[]>;
  listLocal: (agentId: string) => Promise<LocalSkill[]>;
  getState: (agentId: string) => Promise<SkillsState>;
  publish: (input: SkillPublishInput) => Promise<SkillPublishResult>;
}
