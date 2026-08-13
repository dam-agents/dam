import type { z } from "zod";
import type {
  localSkillSchema,
  skillCreateLocalInputSchema,
  skillApplyBatchInputSchema,
  skillCreateSourceInputSchema,
  skillDeleteLocalInputSchema,
  skillInstallInputSchema,
  skillListResultSchema,
  skillLocalFilesSchema,
  skillPublishInputSchema,
  skillPublishRecordSchema,
  skillPublishResultSchema,
  scanFailureSchema,
  skillReadLocalInputSchema,
  skillRefSchema,
  skillSchema,
  skillSetApplyInputSchema,
  skillSetApplyResultSchema,
  skillSetCreateInputSchema,
  skillSetDeleteInputSchema,
  skillSetEntrySchema,
  skillSetSchema,
  skillSetSkipReasonSchema,
  skillSourceSchema,
  skillStateOutputSchema,
  skillUninstallInputSchema,
} from "./schemas.js";

export type ScanFailure = z.infer<typeof scanFailureSchema>;
export type ScanFailureCode = ScanFailure["code"];
export type SkillRef = z.infer<typeof skillRefSchema>;
export type SkillSource = z.infer<typeof skillSourceSchema>;
export type Skill = z.infer<typeof skillSchema>;
export type SkillListResult = z.infer<typeof skillListResultSchema>;
export type LocalSkill = z.infer<typeof localSkillSchema>;
export type SkillOrigin = NonNullable<LocalSkill["origin"]>;

export type SkillCreateSourceInput = z.infer<
  typeof skillCreateSourceInputSchema
>;

export type SkillCreateLocalInput = z.infer<typeof skillCreateLocalInputSchema>;

export type SkillDeleteLocalInput = z.infer<typeof skillDeleteLocalInputSchema>;

export type SkillReadLocalInput = z.infer<typeof skillReadLocalInputSchema>;

export type SkillLocalFiles = z.infer<typeof skillLocalFilesSchema>;

export type SkillInstallInput = z.infer<typeof skillInstallInputSchema>;

export type SkillUninstallInput = z.infer<typeof skillUninstallInputSchema>;

export type SkillApplyBatchInput = z.infer<typeof skillApplyBatchInputSchema>;

export type SkillSetEntry = z.infer<typeof skillSetEntrySchema>;

export type SkillSet = z.infer<typeof skillSetSchema>;

export type SkillSetCreateInput = z.infer<typeof skillSetCreateInputSchema>;

export type SkillSetDeleteInput = z.infer<typeof skillSetDeleteInputSchema>;

export type SkillSetApplyInput = z.infer<typeof skillSetApplyInputSchema>;

export type SkillSetApplyResult = z.infer<typeof skillSetApplyResultSchema>;

export type SkillSetSkipReason = z.infer<typeof skillSetSkipReasonSchema>;

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
  list: (sourceId: string, agentId?: string) => Promise<SkillListResult>;
  getSkillContent: (
    sourceId: string,
    name: string,
    agentId?: string,
  ) => Promise<{ content: string; dir?: string }>;
  install: (input: SkillInstallInput) => Promise<SkillRef[]>;
  uninstall: (input: SkillUninstallInput) => Promise<SkillRef[]>;
  applyBatch: (input: SkillApplyBatchInput) => Promise<SkillRef[]>;
  listSets: () => Promise<SkillSet[]>;
  createSet: (input: SkillSetCreateInput) => Promise<SkillSet>;
  deleteSet: (input: SkillSetDeleteInput) => Promise<void>;
  applySets: (input: SkillSetApplyInput) => Promise<SkillSetApplyResult>;
  createLocal: (input: SkillCreateLocalInput) => Promise<LocalSkill[]>;
  deleteLocal: (input: SkillDeleteLocalInput) => Promise<LocalSkill[]>;
  readLocal: (input: SkillReadLocalInput) => Promise<SkillLocalFiles>;
  listLocal: (agentId: string) => Promise<LocalSkill[]>;
  getState: (agentId: string) => Promise<SkillsState>;
  publish: (input: SkillPublishInput) => Promise<SkillPublishResult>;
}
