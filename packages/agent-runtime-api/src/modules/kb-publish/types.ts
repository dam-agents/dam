import type { KbPublishSyncInput } from "./schemas.js";

export interface KbPublishPlanFile {
  path: string;
  sizeBytes: number;
  contentHash: string;
}

export interface KbPublishPlan {
  files: KbPublishPlanFile[];
}

export interface KbPublishUploadedBlob {
  path: string;
  contentHash: string;
  sizeBytes: number;
}

export interface KbPublishSegmentReport {
  bucket: number;
  docCount: number;
  sizeBytes: number;
  degraded: boolean;
}

export interface KbPublishExecuteReport {
  uploadedBlobs: KbPublishUploadedBlob[];
  segments: KbPublishSegmentReport[];
  drifted: string[];
}

export interface KbPublishService {
  sync(input: KbPublishSyncInput): Promise<{ ok: true }>;
}
