import type { z } from "zod";
import type {
  claimInputSchema,
  fileResultInputSchema,
  heartbeatInputSchema,
  jobStatusSchema,
  reportInputSchema,
  satelliteImageSchema,
  satelliteKindSchema,
  satelliteManifestSchema,
  satelliteToolSchema,
} from "./schemas.js";

export type SatelliteKind = z.infer<typeof satelliteKindSchema>;
export type SatelliteTool = z.infer<typeof satelliteToolSchema>;
export type SatelliteImage = z.infer<typeof satelliteImageSchema>;
export type SatelliteManifest = z.infer<typeof satelliteManifestSchema>;
export type JobStatus = z.infer<typeof jobStatusSchema>;
export type ClaimInput = z.infer<typeof claimInputSchema> & {
  incarnation?: string;
};
export type HeartbeatInput = z.infer<typeof heartbeatInputSchema> & {
  incarnation?: string;
};
export type ReportInput = z.infer<typeof reportInputSchema> & {
  incarnation?: string;
};
export type FileResultInput = z.infer<typeof fileResultInputSchema>;

export interface SatelliteView {
  name: string;
  kind: SatelliteKind;
  filesWritable: boolean;
  description: string | null;
  host: string | null;
  online: boolean;
  draining: boolean;
  lastSeenAt: string | null;
  tools: SatelliteTool[];
  maxConcurrent: number;
  activeJobs: number;
  grantedAgentIds: string[];
}

export interface JobView {
  satellite: string;
  sequence: number;
  ref: string;
  agentId: string;
  tool: string;
  args: Record<string, unknown>;
  status: JobStatus;
  exitCode: number | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

export interface JobStarted {
  ref: string;
  satellite: string;
  sequence: number;
  status: Extract<JobStatus, "running" | "queued">;
}

export interface JobOutcome {
  ref: string;
  status: JobStatus;
  isError: boolean;
  exitCode: number | null;
  output: string | null;
  outputPath: string | null;
  truncated: boolean;
  reason: string | null;
  images: SatelliteImage[];
}

export interface CallWorkItem {
  kind: "call";
  sequence: number;
  tool: string;
  args: Record<string, unknown>;
  agent?: { id: string; name: string | null };
  transferToken?: string;
}

export interface CancelWorkItem {
  kind: "cancel";
  sequence: number;
  tool: string;
  args: Record<string, unknown>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: One file operation a files Satellite claims. It is
 * a work item of its own beside a Job because it has no sequence and no
 * outcome: it is answered on the request that asked for it, so the id it carries
 * is the operation's own, its deadline is the instant the Agent stops waiting,
 * and the body rides as base64 beside it.
 */
export interface FileWorkItem {
  kind: "file";
  id: string;
  op: string;
  path?: string;
  args?: Record<string, unknown>;
  data?: string;
  deadline: number;
  agent?: { id: string; name: string | null };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: What a worker claims from its long-poll. A tools
 * Satellite is handed calls and cancellations; a files Satellite only ever
 * receives file operations, since it has no tools and no Jobs.
 */
export type WorkItem = CallWorkItem | CancelWorkItem | FileWorkItem;

export interface SatellitesService {
  list(): Promise<SatelliteView[]>;
  remove(name: string): Promise<void>;
  grant(name: string, agentId: string): Promise<void>;
  revoke(name: string, agentId: string): Promise<void>;
  listJobs(name: string): Promise<JobView[]>;
  cancelJob(name: string, sequence: number): Promise<void>;
}

export interface SatelliteWorkerOps {
  connect(
    owner: string,
    manifest: SatelliteManifest,
    host?: string,
    resume?: string,
  ): Promise<{ incarnation: string }>;
  claim(owner: string, input: ClaimInput): Promise<WorkItem[]>;
  heartbeat(owner: string, input: HeartbeatInput): Promise<void>;
  report(owner: string, input: ReportInput): Promise<void>;
  fileResult(owner: string, input: FileResultInput): Promise<void>;
  drain(owner: string, satellite: string, incarnation?: string): Promise<void>;
}
