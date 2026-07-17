/** Internal-link scheme for artifacts: the MCP layer mints these for agents
 *  to paste into chat replies, and the UI parses them back into inline
 *  preview chips — the two ends must stay in lock-step, so both import from
 *  here. */
export const ARTIFACT_INTERNAL_LINK_PREFIX = "platform://artifacts/";

export function artifactInternalLink(id: string): string {
  return `${ARTIFACT_INTERNAL_LINK_PREFIX}${id}`;
}

/** How an artifact is rendered — on the public share page and in-app. Detected
 *  from the file name / content at create time, never trusted from the wire
 *  content-type alone. `code`/`text` render highlighted/plain; `binary` is
 *  download-only (images preview inline). */
export type ArtifactKind =
  | "html"
  | "jsx"
  | "markdown"
  | "code"
  | "text"
  | "binary";

/** `private` — in-app only (default). `public` — the share slug resolves on
 *  the share host; the unguessable slug is the entire access control. */
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
  /** Attribution: which agent published it; null = uploaded by the user.
   *  Plain string — artifacts deliberately outlive their creating agent. */
  agentId: string | null;
  visibility: ArtifactVisibility;
  expiresAt: string | null;
  viewCount: number;
  /** Absolute public link, present when visibility is public. */
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

/** In-app preview payload — mirrors the file viewer's FileContent shape so the
 *  UI reuses its rendering stack. `content` is utf-8 for text kinds, base64
 *  when `binary`. `tooLarge` suppresses content for oversized text blobs. */
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

/** Exactly one of `content` (inline utf-8 text) or `uploadRef` (a completed
 *  direct upload minted by `createUploadUrl`) carries the bytes. */
export interface ArtifactCreateInput {
  title: string;
  content?: string;
  uploadRef?: string;
  fileName?: string;
  kind?: ArtifactKind;
  contentType?: string;
  folderId?: string;
  visibility?: ArtifactVisibility;
  /** Hours until the artifact expires; omitted/null = never. Expiry is
   *  retention: the artifact is permanently deleted after a grace window,
   *  regardless of visibility. */
  expiresInHours?: number | null;
}

export interface ArtifactUpdateInput {
  title?: string;
  /** null moves the artifact out of its folder. */
  folderId?: string | null;
  /** Either field publishes a new version. */
  content?: string;
  uploadRef?: string;
  fileName?: string;
  kind?: ArtifactKind;
  contentType?: string;
}

export interface ArtifactSharingInput {
  visibility?: ArtifactVisibility;
  /** null removes the expiry. */
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

/** Owner-scoped application service — composed per owner for the user tRPC
 *  router and the in-pod MCP session alike (owner bound at composition time,
 *  never taken from request input). `agentId` on create/update is attribution
 *  supplied by the MCP layer from the network-verified caller — the tRPC
 *  router never passes it. */
export interface ArtifactLibraryService {
  list(filter?: ArtifactListFilter): Promise<LibraryArtifact[]>;
  get(id: string): Promise<LibraryArtifact | null>;
  getContent(id: string, version?: number): Promise<ArtifactContent | null>;
  /** Self-contained HTML document rendering the artifact — the same inner
   *  document the public share page hosts. Meant for a sandboxed iframe
   *  (`srcdoc`, no allow-same-origin). null when the artifact is binary or
   *  too large to render. */
  getPreviewHtml(id: string, version?: number): Promise<string | null>;
  listVersions(id: string): Promise<ArtifactVersionInfo[]>;
  create(
    input: ArtifactCreateInput,
    attribution?: { agentId: string },
  ): Promise<LibraryArtifact>;
  update(id: string, input: ArtifactUpdateInput): Promise<LibraryArtifact>;
  setSharing(id: string, input: ArtifactSharingInput): Promise<LibraryArtifact>;
  delete(id: string): Promise<void>;
  /** Mint a short-lived direct-upload link (experiments-style direct
   *  transfer). Fails when no object store is configured. */
  createUploadUrl(fileName: string): Promise<ArtifactUploadTicket>;

  listFolders(): Promise<ArtifactFolder[]>;
  createFolder(name: string): Promise<ArtifactFolder>;
  updateFolder(id: string, input: FolderUpdateInput): Promise<ArtifactFolder>;
  /** Artifacts inside become ungrouped; their own share state is untouched. */
  deleteFolder(id: string): Promise<void>;
  /** Absolute public link for a folder page, or null while it has no shared
   *  artifacts. */
  folderShareUrl(id: string): Promise<string | null>;
}
