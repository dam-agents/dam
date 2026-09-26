import type { z } from "zod";
import type {
  claimInputSchema,
  heartbeatInputSchema,
  jobStatusSchema,
  reportInputSchema,
  satelliteManifestSchema,
  satelliteToolSchema,
} from "./schemas.js";

export type SatelliteTool = z.infer<typeof satelliteToolSchema>;
export type SatelliteManifest = z.infer<typeof satelliteManifestSchema>;
export type JobStatus = z.infer<typeof jobStatusSchema>;
export type ClaimInput = z.infer<typeof claimInputSchema>;
export type HeartbeatInput = z.infer<typeof heartbeatInputSchema>;
export type ReportInput = z.infer<typeof reportInputSchema>;

export interface SatelliteView {
  name: string;
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
}

export interface WorkItem {
  kind: "call" | "cancel";
  sequence: number;
  tool: string;
  args: Record<string, unknown>;
  agent?: { id: string; name: string | null };
}

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
  ): Promise<void>;
  claim(owner: string, input: ClaimInput): Promise<WorkItem[]>;
  heartbeat(owner: string, input: HeartbeatInput): Promise<void>;
  report(owner: string, input: ReportInput): Promise<void>;
  drain(owner: string, satellite: string): Promise<void>;
}
