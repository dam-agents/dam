import type {
  HarnessCapability,
  HarnessConfigCatalog,
} from "agent-runtime-api";
import type { z } from "zod";
import type {
  defaultKindSchema,
  harnessConfigSnapshotResultSchema,
  harnessConfigSnapshotSchema,
  sessionDefaultsSchema,
  sessionDefaultsViewSchema,
  sessionPairSchema,
} from "./schemas.js";

export type SessionPair = z.infer<typeof sessionPairSchema>;
export type DefaultKind = z.infer<typeof defaultKindSchema>;
export type SessionDefaults = z.infer<typeof sessionDefaultsSchema>;
export type SessionDefaultsView = z.infer<typeof sessionDefaultsViewSchema>;

/* UNIT_BOUNDARY_DESCRIPTION: a chat default is a profile reference or an inline
 * pair; a reference names a profile the agent's owner holds, and the runtime is
 * sent the pair it resolves to. */
export interface SessionPairReferences {
  profileId?: string | null;
  platformSubagentProfileId?: string | null;
}

/** UNIT_BOUNDARY_DESCRIPTION: what a profile edit did for one agent that points at it — republished, or kept its previous pair with the reason it cannot take the new one. */
export type RepublishDefaultsResult =
  { published: true } | { published: false; reason: string };

export interface HarnessConfigChange {
  harness?: string;
  model?: string;
  mode?: string;
  configOptions?: Record<string, string>;
  unset?: string[];
}

export interface HarnessConfigStatus {
  supported: boolean;
  catalog: HarnessConfigCatalog | null;
  sessionModel: boolean;
  modelRouter: boolean;
  followsDefaults: boolean;
  defaultHarness: string | null;
  harnesses: HarnessCapability[] | null;
}

export interface HarnessConfigSettled {
  settled: boolean;
}

export type HarnessConfigSnapshot = z.infer<typeof harnessConfigSnapshotSchema>;

export type HarnessConfigSnapshotPatch = Partial<
  Omit<HarnessConfigSnapshot, "capturedAt" | "confirmed" | "harnesses">
>;

export type HarnessConfigSnapshotResult = z.infer<
  typeof harnessConfigSnapshotResultSchema
>;

export interface HarnessConfigService {
  apply(agentId: string, change: HarnessConfigChange): Promise<void>;
  status(agentId: string): Promise<HarnessConfigStatus>;
  settled(agentId: string): Promise<HarnessConfigSettled>;
  snapshot(
    agentId: string,
    harness?: string,
  ): Promise<HarnessConfigSnapshotResult>;
  sessionPair(agentId: string, kind: DefaultKind): Promise<SessionPair | null>;
  sessionDefaults(agentId: string): Promise<SessionDefaultsView>;
  rememberSessionPair(
    agentId: string,
    kind: DefaultKind,
    pair: SessionPair,
    references?: SessionPairReferences,
  ): Promise<void>;
  clearSessionDefault(
    agentId: string,
    kind: Exclude<DefaultKind, "chat">,
  ): Promise<void>;
  /** UNIT_BOUNDARY_DESCRIPTION: after a profile an agent points at changed, send that agent its new effective pair, or report why it keeps the one it holds. */
  republishDefaults(agentId: string): Promise<RepublishDefaultsResult>;
  defaultFor(
    agentId: string,
    kind: DefaultKind,
    harness?: string,
  ): Promise<SessionPair | null>;
}
