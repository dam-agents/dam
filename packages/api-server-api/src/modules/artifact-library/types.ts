export const ARTIFACT_INTERNAL_LINK_PREFIX = "platform://artifacts/";

export const ARTIFACT_RESTORE_WINDOW_DAYS = 7;

export function artifactInternalLink(id: string): string {
  return `${ARTIFACT_INTERNAL_LINK_PREFIX}${id}`;
}

export type ArtifactKind =
  | "html"
  | "jsx"
  | "markdown"
  | "code"
  | "text"
  | "binary";

export type ArtifactVisibility = "private" | "public";

export interface ArtifactFolder {
  id: string;
  name: string;
  slug: string;
  artifactCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryArtifact {
  id: string;
  title: string;
  slug: string;
  kind: ArtifactKind;
  contentType: string;
  fileName: string;
  sizeBytes: number;
  version: number;
  folderId: string | null;
  agentId: string | null;
  visibility: ArtifactVisibility;
  interactive: boolean;
  sessionId: string | null;
  expiresAt: string | null;
  viewCount: number;
  shareUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactVersionInfo {
  version: number;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface ArtifactContent {
  kind: ArtifactKind;
  contentType: string;
  fileName: string;
  content: string;
  binary: boolean;
  tooLarge: boolean;
}

export interface ArtifactListFilter {
  folderId?: string | null;
  agentId?: string;
  search?: string;
}

export interface ArtifactCreateInput {
  title: string;
  content?: string;
  uploadRef?: string;
  fileName?: string;
  kind?: ArtifactKind;
  contentType?: string;
  folderId?: string;
  visibility?: ArtifactVisibility;
  interactive?: boolean;
  expiresInHours?: number | null;
}

export interface ArtifactUpdateInput {
  title?: string;
  folderId?: string | null;
  content?: string;
  uploadRef?: string;
  fileName?: string;
  contentType?: string;
}

export interface ArtifactSharingInput {
  visibility?: ArtifactVisibility;
  expiresInHours?: number | null;
}

export interface FolderUpdateInput {
  name?: string;
}

export interface ArtifactUploadTicket {
  url: string;
  uploadRef: string;
  expiresSeconds: number;
  maxBytes: number;
}

export interface ArtifactLibraryService {
  list(filter?: ArtifactListFilter): Promise<LibraryArtifact[]>;
  get(id: string): Promise<LibraryArtifact | null>;
  getContent(id: string, version?: number): Promise<ArtifactContent | null>;
  getPreviewHtml(id: string, version?: number): Promise<string | null>;
  listVersions(id: string): Promise<ArtifactVersionInfo[]>;
  create(
    input: ArtifactCreateInput,
    attribution?: { agentId: string; internal?: boolean },
  ): Promise<LibraryArtifact>;
  update(id: string, input: ArtifactUpdateInput): Promise<LibraryArtifact>;
  setSharing(id: string, input: ArtifactSharingInput): Promise<LibraryArtifact>;
  delete(id: string): Promise<void>;
  createUploadUrl(fileName: string): Promise<ArtifactUploadTicket>;

  listFolders(): Promise<ArtifactFolder[]>;
  createFolder(name: string): Promise<ArtifactFolder>;
  updateFolder(id: string, input: FolderUpdateInput): Promise<ArtifactFolder>;
  deleteFolder(id: string): Promise<void>;
  folderShareUrl(id: string): Promise<string | null>;
}

export type ArtifactRequestState =
  | "pending"
  | "delivered"
  | "answered"
  | "failed";

export type ArtifactRequestFailureReason =
  | "agent_deleted"
  | "session_deleted"
  | "not_bound"
  | "wake_failed"
  | "over_budget"
  | "rate_limited"
  | "busy"
  | "cancelled"
  | "expired";

export interface ArtifactRequest {
  id: string;
  artifactId: string;
  agentId: string;
  seq: number;
  action: string;
  payload: Record<string, unknown>;
  state: ArtifactRequestState;
  result: unknown;
  failureReason: ArtifactRequestFailureReason | null;
  createdAt: string;
  settledAt: string | null;
}

export interface ArtifactRequestReceipt {
  requestId: string;
  seq: number;
  state: ArtifactRequestState;
}

export interface ArtifactRequestCreateInput {
  artifactId: string;
  action: string;
  payload?: Record<string, unknown>;
  sessionId?: string;
}

export interface ArtifactRequestsService {
  create(input: ArtifactRequestCreateInput): Promise<ArtifactRequestReceipt>;
  get(requestId: string): Promise<ArtifactRequest | null>;
  cancel(requestId: string): Promise<ArtifactRequest>;
}

export type ArtifactRequestProgress = "sent" | "waking" | "queued" | "running";

export interface PageArtifactRequest {
  type: "artifact.request";
  ref: string;
  action: string;
  payload?: Record<string, unknown>;
}

export type ArtifactBridgeReply =
  | { type: "artifact.state"; ref: string; state: ArtifactRequestProgress }
  | { type: "artifact.answer"; ref: string; result: unknown }
  | {
      type: "artifact.failed";
      ref: string;
      reason: ArtifactRequestFailureReason;
      message: string;
    };
