import {
  and,
  asc,
  desc,
  eq,
  ilike,
  isNull,
  lt,
  inArray,
  or,
  sql,
  type Db,
  artifactFolders as foldersTable,
  libraryArtifacts as artifactsTable,
  libraryArtifactVersions as versionsTable,
} from "db";

export interface ArtifactRow {
  id: string;
  owner: string;
  agentId: string | null;
  folderId: string | null;
  title: string;
  slug: string;
  kind: string;
  contentType: string;
  fileName: string;
  storageRef: string;
  sizeBytes: number;
  version: number;
  visibility: string;
  expiresAt: Date | null;
  viewCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface FolderRow {
  id: string;
  owner: string;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}

const TOUCH_LIMIT_DEFAULT = 200;
const TOUCH_LIMIT_MAX = 200;

function clampTouchLimit(limit: number | undefined): number {
  if (limit === undefined) return TOUCH_LIMIT_DEFAULT;
  return Math.min(Math.max(1, Math.trunc(limit)), TOUCH_LIMIT_MAX);
}

export interface TouchRow {
  artifactId: string;
  version: number;
  agentId: string;
  sessionId: string;
  touchedAt: Date;
}

export interface VersionRow {
  artifactId: string;
  version: number;
  storageRef: string;
  contentType: string;
  sizeBytes: number;
  createdAt: Date;
}

export interface ArtifactListQuery {
  owner: string;
  folderId?: string | null;
  agentId?: string;
  search?: string;
  limit: number;
}

export const SHARED_FOLDER_PAGE_LIMIT = 500;

export type ArtifactPatch = Partial<
  Pick<
    ArtifactRow,
    | "title"
    | "folderId"
    | "kind"
    | "contentType"
    | "fileName"
    | "storageRef"
    | "sizeBytes"
    | "version"
    | "visibility"
    | "expiresAt"
  >
>;

export interface ArtifactLibraryRepository {
  insertArtifact(
    row: Omit<ArtifactRow, "createdAt" | "updatedAt" | "viewCount">,
  ): Promise<ArtifactRow>;
  getArtifact(id: string, owner: string): Promise<ArtifactRow | null>;
  getArtifactBySlug(slug: string): Promise<ArtifactRow | null>;
  listArtifacts(query: ArtifactListQuery): Promise<ArtifactRow[]>;
  listSharedInFolder(folderId: string): Promise<ArtifactRow[]>;
  countSharedInFolder(folderId: string): Promise<number>;
  updateArtifact(
    id: string,
    owner: string,
    patch: ArtifactPatch,
  ): Promise<ArtifactRow | null>;
  deleteArtifactWithVersions(
    id: string,
    owner: string,
  ): Promise<{ artifact: ArtifactRow; versions: VersionRow[] } | null>;
  incrementViewCount(id: string): Promise<void>;
  attributeVersion(row: {
    artifactId: string;
    version: number;
    owner: string;
    sessionId: string;
  }): Promise<boolean>;
  listTouches(query: {
    owner: string;
    agentId: string;
    sessionIds: readonly string[];
    limit?: number;
  }): Promise<(TouchRow & { fileName: string })[]>;

  advanceVersion(
    id: string,
    owner: string,
    expectedVersion: number,
    patch: ArtifactPatch,
  ): Promise<ArtifactRow | null>;
  listVersions(artifactId: string): Promise<VersionRow[]>;
  getVersion(artifactId: string, version: number): Promise<VersionRow | null>;

  insertFolder(
    row: Omit<FolderRow, "createdAt" | "updatedAt">,
  ): Promise<FolderRow>;
  getFolder(id: string, owner: string): Promise<FolderRow | null>;
  getFolderBySlug(slug: string): Promise<FolderRow | null>;
  listFolders(
    owner: string,
  ): Promise<Array<FolderRow & { artifactCount: number }>>;
  updateFolder(
    id: string,
    owner: string,
    patch: Partial<Pick<FolderRow, "name">>,
  ): Promise<FolderRow | null>;
  deleteFolder(id: string, owner: string): Promise<boolean>;

  listExpiredBefore(cutoff: Date, limit: number): Promise<ArtifactRow[]>;
}

export function createArtifactLibraryRepository(
  db: Db,
): ArtifactLibraryRepository {
  const artifactColumns = {
    id: artifactsTable.id,
    owner: artifactsTable.owner,
    agentId: artifactsTable.agentId,
    folderId: artifactsTable.folderId,
    title: artifactsTable.title,
    slug: artifactsTable.slug,
    kind: artifactsTable.kind,
    contentType: artifactsTable.contentType,
    fileName: artifactsTable.fileName,
    storageRef: artifactsTable.storageRef,
    sizeBytes: artifactsTable.sizeBytes,
    version: artifactsTable.version,
    visibility: artifactsTable.visibility,
    expiresAt: artifactsTable.expiresAt,
    viewCount: artifactsTable.viewCount,
    createdAt: artifactsTable.createdAt,
    updatedAt: artifactsTable.updatedAt,
  };

  return {
    async insertArtifact(row) {
      return db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(artifactsTable)
          .values(row)
          .returning(artifactColumns);
        await tx.insert(versionsTable).values({
          artifactId: inserted!.id,
          version: inserted!.version,
          storageRef: inserted!.storageRef,
          contentType: inserted!.contentType,
          sizeBytes: inserted!.sizeBytes,
        });
        return inserted!;
      });
    },

    async getArtifact(id, owner) {
      const [row] = await db
        .select(artifactColumns)
        .from(artifactsTable)
        .where(and(eq(artifactsTable.id, id), eq(artifactsTable.owner, owner)))
        .limit(1);
      return row ?? null;
    },

    async getArtifactBySlug(slug) {
      const [row] = await db
        .select(artifactColumns)
        .from(artifactsTable)
        .where(eq(artifactsTable.slug, slug))
        .limit(1);
      return row ?? null;
    },

    async listArtifacts(query) {
      const conditions = [eq(artifactsTable.owner, query.owner)];
      if (query.folderId === null)
        conditions.push(isNull(artifactsTable.folderId));
      else if (query.folderId !== undefined)
        conditions.push(eq(artifactsTable.folderId, query.folderId));
      if (query.agentId !== undefined)
        conditions.push(eq(artifactsTable.agentId, query.agentId));
      if (query.search) {
        const term = `%${query.search.replace(/[%_\\]/g, "\\$&")}%`;
        conditions.push(
          or(
            ilike(artifactsTable.title, term),
            ilike(artifactsTable.fileName, term),
          )!,
        );
      }
      return db
        .select(artifactColumns)
        .from(artifactsTable)
        .where(and(...conditions))
        .orderBy(desc(artifactsTable.createdAt))
        .limit(query.limit);
    },

    async listSharedInFolder(folderId) {
      return db
        .select(artifactColumns)
        .from(artifactsTable)
        .where(
          and(
            eq(artifactsTable.folderId, folderId),
            eq(artifactsTable.visibility, "public"),
          ),
        )
        .orderBy(desc(artifactsTable.createdAt))
        .limit(SHARED_FOLDER_PAGE_LIMIT);
    },

    async countSharedInFolder(folderId) {
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(artifactsTable)
        .where(
          and(
            eq(artifactsTable.folderId, folderId),
            eq(artifactsTable.visibility, "public"),
          ),
        );
      return row?.count ?? 0;
    },

    async updateArtifact(id, owner, patch) {
      const [row] = await db
        .update(artifactsTable)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(artifactsTable.id, id), eq(artifactsTable.owner, owner)))
        .returning(artifactColumns);
      return row ?? null;
    },

    async deleteArtifactWithVersions(id, owner) {
      return db.transaction(async (tx) => {
        const [head] = await tx
          .select({ id: artifactsTable.id })
          .from(artifactsTable)
          .where(
            and(eq(artifactsTable.id, id), eq(artifactsTable.owner, owner)),
          )
          .for("update");
        if (!head) return null;
        const versions = await tx
          .delete(versionsTable)
          .where(eq(versionsTable.artifactId, id))
          .returning();
        const [artifact] = await tx
          .delete(artifactsTable)
          .where(eq(artifactsTable.id, id))
          .returning(artifactColumns);
        return { artifact: artifact!, versions };
      });
    },

    async incrementViewCount(id) {
      await db
        .update(artifactsTable)
        .set({ viewCount: sql`${artifactsTable.viewCount} + 1` })
        .where(eq(artifactsTable.id, id));
    },

    async attributeVersion({ artifactId, version, owner, sessionId }) {
      const updated = await db
        .update(versionsTable)
        .set({ sessionId })
        .where(
          and(
            eq(versionsTable.artifactId, artifactId),
            eq(versionsTable.version, version),
            or(
              isNull(versionsTable.sessionId),
              eq(versionsTable.sessionId, sessionId),
            ),
            inArray(
              versionsTable.artifactId,
              db
                .select({ id: artifactsTable.id })
                .from(artifactsTable)
                .where(
                  and(
                    eq(artifactsTable.id, artifactId),
                    eq(artifactsTable.owner, owner),
                  ),
                ),
            ),
          ),
        )
        .returning({ artifactId: versionsTable.artifactId });
      return updated.length > 0;
    },

    async listTouches({ owner, agentId, sessionIds, limit }) {
      if (sessionIds.length === 0) return [];
      const rows = await db
        .select({
          artifactId: versionsTable.artifactId,
          version: versionsTable.version,
          sessionId: versionsTable.sessionId,
          touchedAt: versionsTable.createdAt,
          fileName: artifactsTable.fileName,
        })
        .from(versionsTable)
        .innerJoin(
          artifactsTable,
          eq(artifactsTable.id, versionsTable.artifactId),
        )
        .where(
          and(
            eq(artifactsTable.owner, owner),
            eq(artifactsTable.agentId, agentId),
            inArray(versionsTable.sessionId, [...sessionIds]),
          ),
        )
        .orderBy(desc(versionsTable.createdAt))
        .limit(clampTouchLimit(limit));
      return rows.flatMap((row) =>
        row.sessionId === null
          ? []
          : [
              {
                artifactId: row.artifactId,
                version: row.version,
                agentId,
                sessionId: row.sessionId,
                touchedAt: row.touchedAt,
                fileName: row.fileName,
              },
            ],
      );
    },

    async advanceVersion(id, owner, expectedVersion, patch) {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .update(artifactsTable)
          .set({ ...patch, updatedAt: new Date() })
          .where(
            and(
              eq(artifactsTable.id, id),
              eq(artifactsTable.owner, owner),
              eq(artifactsTable.version, expectedVersion),
            ),
          )
          .returning(artifactColumns);
        if (!row) return null;
        await tx.insert(versionsTable).values({
          artifactId: row.id,
          version: row.version,
          storageRef: row.storageRef,
          contentType: row.contentType,
          sizeBytes: row.sizeBytes,
        });
        return row;
      });
    },

    async listVersions(artifactId) {
      return db
        .select()
        .from(versionsTable)
        .where(eq(versionsTable.artifactId, artifactId))
        .orderBy(asc(versionsTable.version));
    },

    async getVersion(artifactId, version) {
      const [row] = await db
        .select()
        .from(versionsTable)
        .where(
          and(
            eq(versionsTable.artifactId, artifactId),
            eq(versionsTable.version, version),
          ),
        )
        .limit(1);
      return row ?? null;
    },

    async insertFolder(row) {
      const [inserted] = await db.insert(foldersTable).values(row).returning();
      return inserted!;
    },

    async getFolder(id, owner) {
      const [row] = await db
        .select()
        .from(foldersTable)
        .where(and(eq(foldersTable.id, id), eq(foldersTable.owner, owner)))
        .limit(1);
      return row ?? null;
    },

    async getFolderBySlug(slug) {
      const [row] = await db
        .select()
        .from(foldersTable)
        .where(eq(foldersTable.slug, slug))
        .limit(1);
      return row ?? null;
    },

    async listFolders(owner) {
      const rows = await db
        .select({
          id: foldersTable.id,
          owner: foldersTable.owner,
          name: foldersTable.name,
          slug: foldersTable.slug,
          createdAt: foldersTable.createdAt,
          updatedAt: foldersTable.updatedAt,
          artifactCount: sql<number>`(
            select count(*)::int from ${artifactsTable}
            where ${artifactsTable.folderId} = ${foldersTable.id}
          )`,
        })
        .from(foldersTable)
        .where(eq(foldersTable.owner, owner))
        .orderBy(asc(foldersTable.name));
      return rows;
    },

    async updateFolder(id, owner, patch) {
      const [row] = await db
        .update(foldersTable)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(foldersTable.id, id), eq(foldersTable.owner, owner)))
        .returning();
      return row ?? null;
    },

    async deleteFolder(id, owner) {
      return db.transaction(async (tx) => {
        const [folder] = await tx
          .select({ id: foldersTable.id })
          .from(foldersTable)
          .where(and(eq(foldersTable.id, id), eq(foldersTable.owner, owner)))
          .for("update");
        if (!folder) return false;
        await tx
          .update(artifactsTable)
          .set({ folderId: null, updatedAt: new Date() })
          .where(eq(artifactsTable.folderId, id));
        await tx.delete(foldersTable).where(eq(foldersTable.id, folder.id));
        return true;
      });
    },

    async listExpiredBefore(cutoff, limit) {
      return db
        .select(artifactColumns)
        .from(artifactsTable)
        .where(lt(artifactsTable.expiresAt, cutoff))
        .orderBy(asc(artifactsTable.expiresAt))
        .limit(limit);
    },
  };
}
