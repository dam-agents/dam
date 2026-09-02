import type { KbPublishSyncInput } from "./schemas.js";

export interface KbPublishPlanFile {
  path: string;
  sizeBytes: number;
  contentHash: string;
}

export interface KbPublishPlan {
  files: KbPublishPlanFile[];
}

export interface KbPublishSegmentReport {
  bucket: number;
  docCount: number;
  sizeBytes: number;
  degraded: boolean;
}

export interface KbPublishExecuteReport {
  segments: KbPublishSegmentReport[];
  drifted: string[];
}

export interface KbPublishService {
  sync(input: KbPublishSyncInput): Promise<{ ok: true }>;
}
