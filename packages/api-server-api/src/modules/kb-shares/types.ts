import type { z } from "zod";
import type {
  kbShareCreateInputSchema,
  kbSharePublishStateSchema,
  kbShareRefreshInputSchema,
  kbShareResolveInputSchema,
  kbShareSetNameInputSchema,
} from "./schemas.js";

export type KbSharePublishState = z.infer<typeof kbSharePublishStateSchema>;

export type KbShareCreateInput = z.infer<typeof kbShareCreateInputSchema>;

export type KbShareRefreshInput = z.infer<typeof kbShareRefreshInputSchema>;

export type KbShareSetNameInput = z.infer<typeof kbShareSetNameInputSchema>;

export type KbShareResolveInput = z.infer<typeof kbShareResolveInputSchema>;

export interface KbShareView {
  agentId: string;
  publicName: string | null;
  roots: readonly string[];
  publishState: KbSharePublishState;
  publishError: string | null;
  snapshotCreatedAt: string | null;
  documentCount: number | null;
  totalSizeBytes: number | null;
  queryCount: number;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface KbShareStringResult {
  shareString: string;
}

export interface KbShareDefaults {
  roots: readonly string[];
  availableRoots: readonly string[];
}

export interface KbShareResolveResult {
  valid: boolean;
  name: string | null;
}

export interface KbSharesService {
  status(agentId: string): Promise<KbShareView | null>;
  list(): Promise<KbShareView[]>;
  defaults(agentId: string): Promise<KbShareDefaults>;
  create(input: KbShareCreateInput): Promise<KbShareView>;
  reveal(agentId: string): Promise<KbShareStringResult>;
  rotate(agentId: string): Promise<KbShareStringResult>;
  revoke(agentId: string): Promise<void>;
  refresh(input: KbShareRefreshInput): Promise<KbShareView>;
  setName(input: KbShareSetNameInput): Promise<KbShareView>;
  resolveLink(input: KbShareResolveInput): Promise<KbShareResolveResult>;
}
