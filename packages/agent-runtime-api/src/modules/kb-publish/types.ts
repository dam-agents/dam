import type { Result } from "../../result.js";
import type { KbPublishFailure } from "../kb-snapshot/failures.js";
import type {
  KbPublishExecuteInput,
  KbPublishPlanInput,
  KbRootsNotice,
} from "./schemas.js";

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
  plan(
    input: KbPublishPlanInput,
  ): Promise<Result<KbPublishPlan, KbPublishFailure>>;
  execute(
    input: KbPublishExecuteInput,
  ): Promise<Result<KbPublishExecuteReport, KbPublishFailure>>;
  watchRoots(
    roots: string[],
    signal?: AbortSignal,
  ): AsyncIterable<KbRootsNotice>;
}
