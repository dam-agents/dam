import { TRPCError } from "@trpc/server";
import type {
  ArtifactContent,
  ArtifactCreateInput,
  ArtifactFolder,
  ArtifactKind,
  ArtifactLibraryService,
  ArtifactListFilter,
  ArtifactSharingInput,
  ArtifactUpdateInput,
  ArtifactUploadTicket,
  ArtifactVersionInfo,
  ArtifactVisibility,
  FolderUpdateInput,
  LibraryArtifact,
} from "api-server-api";

import type { ArtifactService } from "../../artifacts/services/artifact-service.js";
import {
  DEFAULT_CONTENT_TYPE,
  defaultFileName,
  detectKind,
  isTextKind,
} from "../domain/artifact-kind.js";
import { generateId, generateSlug } from "../domain/share-crypto.js";
import {
  isOwnStagingKey,
  stagingKey,
  versionKey,
} from "../domain/storage-key.js";
import type {
  ArtifactLibraryRepository,
  ArtifactRow,
  FolderRow,
} from "../infrastructure/artifact-library-repository.js";
import { renderTextKindInner } from "../viewer/renderer.js";

const LIST_LIMIT = 500;
/** In-app preview ceiling — mirrors the file viewer's 10 MB cap. */
const PREVIEW_MAX_BYTES = 10 * 1024 * 1024;

/** Server-internal surface on top of the contract: the download route and the
 *  MCP layer need the storage ref resolution the tRPC router never sees. */
export interface ArtifactLibraryServiceImpl extends ArtifactLibraryService {
  create(
    input: ArtifactCreateInput,
    attribution?: { agentId: string },
  ): Promise<LibraryArtifact>;
  /** Resolve the stored blob behind an artifact (optionally a past version). */
  resolveContentRef(
    id: string,
    version?: number,
  ): Promise<{
    storageRef: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
  } | null>;
}

export interface ArtifactLibraryDeps {
  repo: ArtifactLibraryRepository;
  /** Shared blob-store service (owner-agnostic) — this module owner-scopes
   *  every key it hands over. */
  artifacts: ArtifactService;
  owner: string;
  /** Absolute origin of the public share host, e.g. https://share.example.com */
  shareBaseUrl: string;
}

export function shareUrlFor(shareBaseUrl: string, slug: string): string {
  return `${shareBaseUrl.replace(/\/+$/, "")}/a/${slug}`;
}

export function folderShareUrlFor(shareBaseUrl: string, slug: string): string {
  return `${shareBaseUrl.replace(/\/+$/, "")}/f/${slug}`;
}

export function toLibraryArtifact(
  row: ArtifactRow,
  shareBaseUrl: string,
): LibraryArtifact {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    kind: row.kind as ArtifactKind,
    contentType: row.contentType,
    fileName: row.fileName,
    sizeBytes: row.sizeBytes,
    version: row.version,
    folderId: row.folderId,
    agentId: row.agentId,
    visibility: row.visibility as ArtifactVisibility,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    viewCount: row.viewCount,
    shareUrl:
      row.visibility === "public" ? shareUrlFor(shareBaseUrl, row.slug) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toFolder(row: FolderRow & { artifactCount: number }): ArtifactFolder {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    artifactCount: row.artifactCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function expiresAtFrom(expiresInHours: number | null | undefined): Date | null {
  if (expiresInHours == null) return null;
  return new Date(Date.now() + expiresInHours * 3600_000);
}

export function createArtifactLibraryService(
  deps: ArtifactLibraryDeps,
): ArtifactLibraryServiceImpl {
  const { repo, artifacts, owner, shareBaseUrl } = deps;

  async function requireOwnedFolder(folderId: string): Promise<FolderRow> {
    const folder = await repo.getFolder(folderId, owner);
    if (!folder)
      throw new TRPCError({ code: "NOT_FOUND", message: "folder not found" });
    return folder;
  }

  async function requireArtifact(id: string): Promise<ArtifactRow> {
    const row = await repo.getArtifact(id, owner);
    if (!row)
      throw new TRPCError({ code: "NOT_FOUND", message: "artifact not found" });
    return row;
  }

  /** Resolve the incoming bytes: inline utf-8 content is stored by us at
   *  `key`; a direct upload is verified in place (its staged key becomes the
   *  version's ref). Returns the stored ref + stat. */
  async function ingestBytes(input: {
    content?: string;
    uploadRef?: string;
    key: string;
    contentType: string;
  }): Promise<{ storageRef: string; sizeBytes: number; contentType: string }> {
    if (input.content != null) {
      const buffer = Buffer.from(input.content, "utf8");
      await artifacts.put({
        key: input.key,
        content: buffer,
        contentType: input.contentType,
      });
      return {
        storageRef: input.key,
        sizeBytes: buffer.byteLength,
        contentType: input.contentType,
      };
    }
    const ref = input.uploadRef!;
    // A ref outside the caller's own staging prefix reads as unknown — the
    // upload ticket is the capability, and it was minted owner-scoped.
    if (!isOwnStagingKey(owner, ref))
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "unknown uploadRef",
      });
    const stat = await artifacts.verifyUpload(ref);
    return {
      storageRef: ref,
      sizeBytes: stat.sizeBytes,
      contentType: stat.contentType || input.contentType,
    };
  }

  return {
    async list(filter?: ArtifactListFilter) {
      const rows = await repo.listArtifacts({
        owner,
        folderId: filter?.folderId,
        agentId: filter?.agentId,
        search: filter?.search,
        limit: LIST_LIMIT,
      });
      return rows.map((r) => toLibraryArtifact(r, shareBaseUrl));
    },

    async get(id) {
      const row = await repo.getArtifact(id, owner);
      return row ? toLibraryArtifact(row, shareBaseUrl) : null;
    },

    async getContent(id, version) {
      const ref = await this.resolveContentRef(id, version);
      if (!ref) return null;
      const row = await repo.getArtifact(id, owner);
      const kind = (row?.kind ?? "binary") as ArtifactKind;
      if (ref.sizeBytes > PREVIEW_MAX_BYTES) {
        return {
          kind,
          contentType: ref.contentType,
          fileName: ref.fileName,
          content: "",
          binary: !isTextKind(kind),
          tooLarge: true,
        } satisfies ArtifactContent;
      }
      const blob = await artifacts.get(ref.storageRef);
      if (!blob) return null;
      const binary = !isTextKind(kind);
      return {
        kind,
        contentType: ref.contentType,
        fileName: ref.fileName,
        content: binary
          ? blob.content.toString("base64")
          : blob.content.toString("utf8"),
        binary,
        tooLarge: false,
      } satisfies ArtifactContent;
    },

    async getPreviewHtml(id, version) {
      const row = await repo.getArtifact(id, owner);
      if (!row || row.kind === "binary") return null;
      const ref = await this.resolveContentRef(id, version);
      if (!ref || ref.sizeBytes > PREVIEW_MAX_BYTES) return null;
      const blob = await artifacts.get(ref.storageRef);
      if (!blob) return null;
      return renderTextKindInner(
        row.kind as Exclude<ArtifactKind, "binary">,
        blob.content.toString("utf8"),
        { title: row.title, fileName: ref.fileName },
      );
    },

    async listVersions(id) {
      const row = await requireArtifact(id);
      const prior = await repo.listVersions(id);
      const infos: ArtifactVersionInfo[] = prior.map((v) => ({
        version: v.version,
        contentType: v.contentType,
        sizeBytes: v.sizeBytes,
        createdAt: v.createdAt.toISOString(),
      }));
      infos.push({
        version: row.version,
        contentType: row.contentType,
        sizeBytes: row.sizeBytes,
        createdAt: row.updatedAt.toISOString(),
      });
      return infos;
    },

    async create(input, attribution) {
      if (input.folderId) await requireOwnedFolder(input.folderId);

      const contentBuffer =
        input.content != null ? Buffer.from(input.content, "utf8") : undefined;
      const kind = detectKind({
        explicit: input.kind,
        fileName: input.fileName,
        content: contentBuffer,
      });
      const fileName = input.fileName ?? defaultFileName(input.title, kind);
      const contentType = input.contentType ?? DEFAULT_CONTENT_TYPE[kind];

      const id = generateId();
      const key = versionKey(owner, id, 1, fileName);
      const stored = await ingestBytes({
        content: input.content,
        uploadRef: input.uploadRef,
        key,
        contentType,
      });

      const row = await repo.insertArtifact({
        id,
        owner,
        agentId: attribution?.agentId ?? null,
        folderId: input.folderId ?? null,
        title: input.title,
        slug: generateSlug(),
        kind,
        contentType: stored.contentType,
        fileName,
        storageRef: stored.storageRef,
        sizeBytes: stored.sizeBytes,
        version: 1,
        visibility: input.visibility ?? "private",
        expiresAt: expiresAtFrom(input.expiresInHours),
      });
      return toLibraryArtifact(row, shareBaseUrl);
    },

    async update(id, input: ArtifactUpdateInput) {
      const row = await requireArtifact(id);
      if (input.folderId != null) await requireOwnedFolder(input.folderId);

      const patch: Parameters<typeof repo.updateArtifact>[2] = {};
      if (input.title !== undefined) patch.title = input.title;
      if (input.folderId !== undefined) patch.folderId = input.folderId;

      if (input.content != null || input.uploadRef != null) {
        const contentBuffer =
          input.content != null
            ? Buffer.from(input.content, "utf8")
            : undefined;
        const kind = detectKind({
          explicit: input.kind,
          fileName: input.fileName ?? row.fileName,
          content: contentBuffer,
        });
        const fileName = input.fileName ?? row.fileName;
        const contentType = input.contentType ?? DEFAULT_CONTENT_TYPE[kind];
        const nextVersion = row.version + 1;
        const key = versionKey(owner, id, nextVersion, fileName);
        const stored = await ingestBytes({
          content: input.content,
          uploadRef: input.uploadRef,
          key,
          contentType,
        });
        patch.version = nextVersion;
        patch.storageRef = stored.storageRef;
        patch.sizeBytes = stored.sizeBytes;
        patch.contentType = stored.contentType;
        patch.fileName = fileName;
        patch.kind = kind;
        // Snapshot the outgoing current version and advance the head row in
        // one transaction.
        const advanced = await repo.advanceVersion(
          id,
          owner,
          {
            artifactId: id,
            version: row.version,
            storageRef: row.storageRef,
            contentType: row.contentType,
            sizeBytes: row.sizeBytes,
          },
          patch,
        );
        if (!advanced) throw new TRPCError({ code: "NOT_FOUND" });
        return toLibraryArtifact(advanced, shareBaseUrl);
      } else {
        if (input.fileName !== undefined) patch.fileName = input.fileName;
        if (input.kind !== undefined) patch.kind = input.kind;
        if (input.contentType !== undefined)
          patch.contentType = input.contentType;
      }

      const updated = await repo.updateArtifact(id, owner, patch);
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return toLibraryArtifact(updated, shareBaseUrl);
    },

    async setSharing(id, input: ArtifactSharingInput) {
      await requireArtifact(id);
      const patch: Parameters<typeof repo.updateArtifact>[2] = {};
      if (input.visibility !== undefined) patch.visibility = input.visibility;
      if (input.expiresInHours !== undefined)
        patch.expiresAt = expiresAtFrom(input.expiresInHours);
      const updated = await repo.updateArtifact(id, owner, patch);
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return toLibraryArtifact(updated, shareBaseUrl);
    },

    async delete(id) {
      const deleted = await repo.deleteArtifactWithVersions(id, owner);
      if (!deleted) throw new TRPCError({ code: "NOT_FOUND" });
      // Best-effort blob cleanup — a failed delete leaves an orphaned blob;
      // the rows are already gone (atomically), so nothing resolves it again.
      await Promise.allSettled(
        [
          deleted.artifact.storageRef,
          ...deleted.versions.map((v) => v.storageRef),
        ].map((ref) => artifacts.delete(ref)),
      );
    },

    async createUploadUrl(fileName): Promise<ArtifactUploadTicket> {
      const key = stagingKey(owner, fileName);
      const ticket = await artifacts.createUploadUrl(key);
      if (!ticket) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "No object store is configured — the artifact library requires one.",
        });
      }
      return {
        url: ticket.url,
        uploadRef: key,
        expiresSeconds: ticket.expiresSeconds,
        maxBytes: artifacts.maxBytes,
      };
    },

    async listFolders() {
      const rows = await repo.listFolders(owner);
      return rows.map(toFolder);
    },

    async createFolder(name) {
      const row = await repo.insertFolder({
        id: generateId(),
        owner,
        name,
        slug: generateSlug(),
      });
      return toFolder({ ...row, artifactCount: 0 });
    },

    async updateFolder(id, input: FolderUpdateInput) {
      await requireOwnedFolder(id);
      const patch: Parameters<typeof repo.updateFolder>[2] = {};
      if (input.name !== undefined) patch.name = input.name;
      const updated = await repo.updateFolder(id, owner, patch);
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      const count = await repo.countSharedInFolder(id);
      return toFolder({ ...updated, artifactCount: count });
    },

    async deleteFolder(id) {
      const deleted = await repo.deleteFolder(id, owner);
      if (!deleted) throw new TRPCError({ code: "NOT_FOUND" });
    },

    async folderShareUrl(id) {
      const folder = await requireOwnedFolder(id);
      const shared = await repo.countSharedInFolder(id);
      return shared > 0 ? folderShareUrlFor(shareBaseUrl, folder.slug) : null;
    },

    async resolveContentRef(id, version) {
      const row = await repo.getArtifact(id, owner);
      if (!row) return null;
      if (version === undefined || version === row.version) {
        return {
          storageRef: row.storageRef,
          fileName: row.fileName,
          contentType: row.contentType,
          sizeBytes: row.sizeBytes,
        };
      }
      const past = await repo.getVersion(id, version);
      if (!past) return null;
      return {
        storageRef: past.storageRef,
        fileName: row.fileName,
        contentType: past.contentType,
        sizeBytes: past.sizeBytes,
      };
    },
  };
}
