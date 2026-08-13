import { describe, expect, it } from "vitest";

import {
  DEFAULT_CONTENT_TYPE,
  defaultFileName,
  detectKind,
  extensionOf,
} from "../../modules/artifact-library/domain/artifact-kind.js";
import { generateSlug } from "../../modules/artifact-library/domain/share-crypto.js";
import {
  isOwnStagingKey,
  stagingKey,
  versionKey,
} from "../../modules/artifact-library/domain/storage-key.js";
import { createShareViewerService } from "../../modules/artifact-library/services/share-viewer-service.js";
import type {
  ArtifactLibraryRepository,
  ArtifactRow,
  FolderRow,
} from "../../modules/artifact-library/infrastructure/artifact-library-repository.js";
import type { ArtifactService } from "../../modules/artifacts/services/artifact-service.js";

describe("share-crypto — slugs", () => {
  it("generates unguessable url-safe slugs", () => {
    const slugs = new Set(Array.from({ length: 100 }, generateSlug));
    expect(slugs.size).toBe(100);
    for (const slug of slugs) expect(slug).toMatch(/^[A-Za-z0-9_-]{10,}$/);
  });
});

describe("artifact-kind detection", () => {
  it("maps extensions first", () => {
    expect(detectKind({ fileName: "index.html" })).toBe("html");
    expect(detectKind({ fileName: "App.jsx" })).toBe("jsx");
    expect(detectKind({ fileName: "notes.md" })).toBe("markdown");
    expect(detectKind({ fileName: "main.py" })).toBe("code");
    expect(detectKind({ fileName: "data.csv" })).toBe("text");
    expect(detectKind({ fileName: "photo.png" })).toBe("binary");
  });

  it("sniffs content when there is no useful extension", () => {
    expect(
      detectKind({ content: Buffer.from("<!DOCTYPE html><html></html>") }),
    ).toBe("html");
    expect(
      detectKind({ content: Buffer.from('import React from "react";') }),
    ).toBe("jsx");
    expect(
      detectKind({ content: Buffer.from("export default function App() {}") }),
    ).toBe("jsx");
    expect(detectKind({ content: Buffer.from("plain notes") })).toBe("text");
    expect(detectKind({ content: Buffer.from([0x89, 0x50, 0x00, 0x47]) })).toBe(
      "binary",
    );
  });

  it("lets HTML anchors win over embedded React signals (slop rule)", () => {
    const htmlWithReact = `<!DOCTYPE html><html><body><script>const {useState} = React;</script></body></html>`;
    expect(detectKind({ content: Buffer.from(htmlWithReact) })).toBe("html");
  });

  it("prefers the explicit kind over everything", () => {
    expect(detectKind({ explicit: "text", fileName: "index.html" })).toBe(
      "text",
    );
  });

  it("derives sane fallback file names and content types", () => {
    expect(defaultFileName("Weekly Report #7", "markdown")).toBe(
      "weekly-report-7.md",
    );
    expect(extensionOf("a/b/c.tar.gz")).toBe("gz");
    expect(DEFAULT_CONTENT_TYPE.html).toContain("text/html");
  });
});

describe("storage keys", () => {
  it("scopes staging keys per owner", () => {
    const key = stagingKey("owner-a", "report.html");
    expect(isOwnStagingKey("owner-a", key)).toBe(true);
    expect(isOwnStagingKey("owner-b", key)).toBe(false);
  });

  it("sanitizes hostile basenames", () => {
    const key = versionKey("o", "id", 1, '../..\\evil"name\n.html');
    expect(key).toBe(`library/o/id/v1/${key.split("/").pop()}`);
    expect(key.split("/").pop()).toMatch(/^[A-Za-z0-9._-]+$/);
  });
});

function artifactRow(overrides: Partial<ArtifactRow>): ArtifactRow {
  return {
    id: "a1",
    owner: "o1",
    agentId: null,
    folderId: null,
    title: "T",
    slug: "slug-a",
    kind: "html",
    contentType: "text/html",
    fileName: "t.html",
    storageRef: "library/o1/a1/v1/t.html",
    sizeBytes: 10,
    version: 1,
    visibility: "public",
    expiresAt: null,
    viewCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fakeRepo(
  artifacts: ArtifactRow[],
  folders: FolderRow[] = [],
): ArtifactLibraryRepository {
  const notImplemented = () => {
    throw new Error("not implemented in fake");
  };
  return {
    insertArtifact: notImplemented,
    getArtifact: (id, owner) =>
      Promise.resolve(
        artifacts.find((a) => a.id === id && a.owner === owner) ?? null,
      ),
    getArtifactBySlug: (slug) =>
      Promise.resolve(artifacts.find((a) => a.slug === slug) ?? null),
    listArtifacts: (query) =>
      Promise.resolve(artifacts.filter((a) => a.owner === query.owner)),
    listSharedInFolder: (folderId) =>
      Promise.resolve(
        artifacts.filter(
          (a) => a.folderId === folderId && a.visibility === "public",
        ),
      ),
    countSharedInFolder: notImplemented,
    updateArtifact: (id, owner, patch) => {
      const row = artifacts.find((a) => a.id === id && a.owner === owner);
      if (!row) return Promise.resolve(null);
      Object.assign(row, patch, { updatedAt: new Date() });
      return Promise.resolve(row);
    },
    deleteArtifactWithVersions: (id, owner) => {
      const index = artifacts.findIndex(
        (a) => a.id === id && a.owner === owner,
      );
      if (index === -1) return Promise.resolve(null);
      const [artifact] = artifacts.splice(index, 1);
      return Promise.resolve({ artifact: artifact!, versions: [] });
    },
    incrementViewCount: () => Promise.resolve(),
    advanceVersion: notImplemented,
    listVersions: () => Promise.resolve([]),
    getVersion: () => Promise.resolve(null),
    insertFolder: notImplemented,
    getFolder: notImplemented,
    getFolderBySlug: (slug) =>
      Promise.resolve(folders.find((f) => f.slug === slug) ?? null),
    listFolders: notImplemented,
    updateFolder: notImplemented,
    deleteFolder: notImplemented,
    listExpiredBefore: (cutoff, limit) =>
      Promise.resolve(
        artifacts
          .filter((a) => a.expiresAt !== null && a.expiresAt < cutoff)
          .slice(0, limit),
      ),
  };
}

function stubArtifacts(
  overrides: Partial<ArtifactService> = {},
): ArtifactService {
  const notImplemented = () => {
    throw new Error("not implemented in stub");
  };
  return {
    maxBytes: 10 * 1024 * 1024,
    put: notImplemented,
    get: () => Promise.resolve(null),
    getStream: notImplemented,
    exists: notImplemented,
    delete: () => Promise.resolve(),
    createUploadUrl: notImplemented,
    verifyUpload: notImplemented,
    createDownloadUrl: notImplemented,
    createAgentDownloadUrl: notImplemented,
    ...overrides,
  };
}

const fakeArtifacts = stubArtifacts();

describe("share viewer resolution", () => {
  it("resolves only public artifacts — private reads as not-found", async () => {
    const viewer = createShareViewerService({
      repo: fakeRepo([artifactRow({ visibility: "private" })]),
      artifacts: fakeArtifacts,
    });
    await expect(viewer.resolveArtifact("slug-a")).resolves.toEqual({
      state: "not-found",
    });
  });

  it("410s an expired artifact, flagging the grace window", async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000);
    const viewer = createShareViewerService({
      repo: fakeRepo([
        artifactRow({ slug: "recent", expiresAt: twoDaysAgo }),
        artifactRow({ id: "a2", slug: "old", expiresAt: tenDaysAgo }),
      ]),
      artifacts: fakeArtifacts,
    });
    await expect(viewer.resolveArtifact("recent")).resolves.toMatchObject({
      state: "expired",
      withinGrace: true,
    });
    await expect(viewer.resolveArtifact("old")).resolves.toMatchObject({
      state: "expired",
      withinGrace: false,
    });
  });

  it("folder pages with nothing shared read as not-found", async () => {
    const folder: FolderRow = {
      id: "f1",
      owner: "o1",
      name: "F",
      slug: "slug-f",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const viewer = createShareViewerService({
      repo: fakeRepo(
        [artifactRow({ folderId: "f1", visibility: "private" })],
        [folder],
      ),
      artifacts: fakeArtifacts,
    });
    await expect(viewer.resolveFolder("slug-f")).resolves.toEqual({
      state: "not-found",
    });
  });
});

describe("share viewer — meta and content cap", () => {
  const row = artifactRow({ sizeBytes: 40 });
  const viewer = createShareViewerService({
    repo: fakeRepo([row]),
    artifacts: stubArtifacts({
      get: () =>
        Promise.resolve({
          key: row.storageRef,
          content: Buffer.from("x".repeat(40)),
          contentType: "text/html",
          sizeBytes: 40,
          createdAt: new Date(),
        }),
    }),
  });

  it("meta reads size and type without fetching the blob", async () => {
    await expect(viewer.meta(row)).resolves.toEqual({
      contentType: "text/html",
      sizeBytes: 40,
    });
  });

  it("content refuses to buffer past maxBytes", async () => {
    await expect(viewer.content(row, undefined, 10)).resolves.toBeNull();
    await expect(viewer.content(row, undefined, 100)).resolves.toMatchObject({
      sizeBytes: 40,
    });
  });
});

describe("library service — getPreviewHtml", () => {
  async function serviceWith(row: ArtifactRow) {
    const { createArtifactLibraryService } =
      await import("../../modules/artifact-library/services/artifact-library-service.js");
    return createArtifactLibraryService({
      repo: fakeRepo([row]),
      owner: row.owner,
      shareBaseUrl: "http://share.localhost",
      artifacts: stubArtifacts({
        get: (key) =>
          Promise.resolve(
            key === row.storageRef
              ? {
                  key,
                  content: Buffer.from("# Hello <script>alert(1)</script>"),
                  contentType: row.contentType,
                  sizeBytes: 30,
                  createdAt: new Date(),
                }
              : null,
          ),
      }),
    });
  }

  it("renders a markdown artifact into a sanitizing inner document", async () => {
    const service = await serviceWith(
      artifactRow({ kind: "markdown", contentType: "text/markdown" }),
    );
    const html = await service.getPreviewHtml("a1");
    expect(html).toContain("DOMPurify");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("\\u003cscript>alert(1)\\u003c/script>");
  });

  it("returns null for binary artifacts and unknown ids", async () => {
    const service = await serviceWith(
      artifactRow({ kind: "binary", contentType: "image/png" }),
    );
    await expect(service.getPreviewHtml("a1")).resolves.toBeNull();
    await expect(service.getPreviewHtml("missing")).resolves.toBeNull();
  });
});

describe("library service — the kind cannot move", () => {
  async function serviceOver(rows: ArtifactRow[], keys: string[] = []) {
    const { createArtifactLibraryService } =
      await import("../../modules/artifact-library/services/artifact-library-service.js");
    return createArtifactLibraryService({
      repo: {
        ...fakeRepo(rows),
        advanceVersion: (id, owner, _snapshot, patch) => {
          const row = rows.find((a) => a.id === id && a.owner === owner);
          if (!row) return Promise.resolve(null);
          Object.assign(row, patch);
          return Promise.resolve(row);
        },
      },
      owner: "o1",
      shareBaseUrl: "http://share.localhost",
      artifacts: stubArtifacts({
        put: (input) => {
          keys.push(input.key);
          return Promise.resolve();
        },
      }),
    });
  }

  it("keeps the kind when a new version's bytes sniff as something else", async () => {
    const rows = [artifactRow({ kind: "markdown", fileName: "report.md" })];
    const service = await serviceOver(rows);

    await expect(
      service.update("a1", { content: "<!DOCTYPE html><html></html>" }),
    ).resolves.toMatchObject({ kind: "markdown", version: 2 });
  });

  it("keeps the kind across a rename into an executable extension", async () => {
    const rows = [artifactRow({ kind: "markdown", fileName: "report.md" })];
    const keys: string[] = [];
    const service = await serviceOver(rows, keys);

    await expect(
      service.update("a1", {
        content: "<script>alert(1)</script>",
        fileName: "report.html",
      }),
    ).resolves.toMatchObject({ kind: "markdown", fileName: "report.html" });
    expect(keys).toEqual(["library/o1/a1/v2/report.html"]);
  });

  it("renames in place without publishing a version", async () => {
    const rows = [artifactRow({ kind: "code", fileName: "loop.py" })];
    const service = await serviceOver(rows);

    await expect(
      service.update("a1", { fileName: "optimize.py" }),
    ).resolves.toMatchObject({
      fileName: "optimize.py",
      kind: "code",
      version: 1,
    });
  });
});

describe("library service — createAgentDownloadUrl", () => {
  async function serviceOver(
    rows: ArtifactRow[],
    opts?: {
      getVersion?: ArtifactLibraryRepository["getVersion"];
      link?: { url: string; expiresSeconds: number } | null;
      minted?: Array<{ key: string; filename: string }>;
    },
  ) {
    const { createArtifactLibraryService } =
      await import("../../modules/artifact-library/services/artifact-library-service.js");
    return createArtifactLibraryService({
      repo: {
        ...fakeRepo(rows),
        ...(opts?.getVersion ? { getVersion: opts.getVersion } : {}),
      },
      owner: "o1",
      shareBaseUrl: "http://share.localhost",
      artifacts: stubArtifacts({
        createAgentDownloadUrl: (key, filename) => {
          opts?.minted?.push({ key, filename });
          return Promise.resolve(
            opts?.link === undefined
              ? { url: "https://store/get", expiresSeconds: 900 }
              : opts.link,
          );
        },
      }),
    });
  }

  it("mints a ticket for the head version with a header-safe file name", async () => {
    const minted: Array<{ key: string; filename: string }> = [];
    const service = await serviceOver(
      [artifactRow({ fileName: 'evil"name\n.html', sizeBytes: 7 })],
      { minted },
    );
    await expect(service.createAgentDownloadUrl("a1")).resolves.toEqual({
      url: "https://store/get",
      fileName: "evilname.html",
      contentType: "text/html",
      sizeBytes: 7,
      version: 1,
      expiresSeconds: 900,
    });
    expect(minted).toEqual([
      { key: "library/o1/a1/v1/t.html", filename: "evilname.html" },
    ]);
  });

  it("resolves a past version's blob; an unknown version reads as not-found", async () => {
    const service = await serviceOver([artifactRow({ version: 2 })], {
      getVersion: (id, version) =>
        Promise.resolve(
          id === "a1" && version === 1
            ? {
                artifactId: "a1",
                version: 1,
                storageRef: "library/o1/a1/v1/old.html",
                contentType: "text/html",
                sizeBytes: 3,
                createdAt: new Date(),
              }
            : null,
        ),
    });
    await expect(
      service.createAgentDownloadUrl("a1", 1),
    ).resolves.toMatchObject({ version: 1, sizeBytes: 3 });
    await expect(service.createAgentDownloadUrl("a1", 9)).rejects.toThrow(
      /not found/,
    );
  });

  it("fails closed when no object store is configured", async () => {
    const service = await serviceOver([artifactRow({})], { link: null });
    await expect(service.createAgentDownloadUrl("a1")).rejects.toThrow(
      /No object store is configured/,
    );
  });
});

describe("library service — owner scoping", () => {
  async function intruderServiceOver(rows: ArtifactRow[]) {
    const { createArtifactLibraryService } =
      await import("../../modules/artifact-library/services/artifact-library-service.js");
    return createArtifactLibraryService({
      repo: fakeRepo(rows),
      owner: "intruder",
      shareBaseUrl: "http://share.localhost",
      artifacts: stubArtifacts(),
    });
  }

  it("cannot read, list, or resolve another owner's artifact", async () => {
    const service = await intruderServiceOver([artifactRow({ owner: "o1" })]);
    await expect(service.get("a1")).resolves.toBeNull();
    await expect(service.list()).resolves.toEqual([]);
    await expect(service.resolveContentRef("a1")).resolves.toBeNull();
    await expect(service.getContent("a1")).resolves.toBeNull();
    await expect(service.createAgentDownloadUrl("a1")).rejects.toThrow(
      /not found/,
    );
  });

  it("cannot mutate, share, or delete another owner's artifact", async () => {
    const rows = [artifactRow({ owner: "o1" })];
    const service = await intruderServiceOver(rows);
    await expect(service.update("a1", { title: "stolen" })).rejects.toThrow();
    await expect(
      service.setSharing("a1", { visibility: "public" }),
    ).rejects.toThrow();
    await expect(service.delete("a1")).rejects.toThrow();
    await expect(service.listVersions("a1")).rejects.toThrow();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe("T");
    expect(rows[0]!.visibility).toBe("public");
  });
});

describe("expiry sweeper", () => {
  async function sweeperOver(
    rows: ArtifactRow[],
    versions: Record<string, string[]> = {},
  ) {
    const { createArtifactExpirySweeper } =
      await import("../../modules/artifact-library/services/expiry-sweeper.js");
    const deletedBlobs: string[] = [];
    const repo: ArtifactLibraryRepository = {
      ...fakeRepo(rows),
      deleteArtifactWithVersions: (id, owner) => {
        const index = rows.findIndex((a) => a.id === id && a.owner === owner);
        if (index === -1) return Promise.resolve(null);
        const [artifact] = rows.splice(index, 1);
        return Promise.resolve({
          artifact: artifact!,
          versions: (versions[id] ?? []).map((storageRef, i) => ({
            artifactId: id,
            version: i + 1,
            storageRef,
            contentType: "text/html",
            sizeBytes: 1,
            createdAt: new Date(),
          })),
        });
      },
    };
    const sweeper = createArtifactExpirySweeper({
      repo,
      artifacts: stubArtifacts({
        delete: (key) => {
          deletedBlobs.push(key);
          return Promise.resolve();
        },
      }),
      batchSize: 10,
    });
    return { sweeper, deletedBlobs, rows };
  }

  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

  it("hard-deletes artifacts past the grace window — private ones too", async () => {
    const { sweeper, rows } = await sweeperOver([
      artifactRow({ id: "pub", slug: "s1", expiresAt: daysAgo(10) }),
      artifactRow({
        id: "priv",
        slug: "s2",
        visibility: "private",
        expiresAt: daysAgo(10),
      }),
      artifactRow({ id: "grace", slug: "s3", expiresAt: daysAgo(2) }),
      artifactRow({ id: "keep", slug: "s4", expiresAt: null }),
    ]);
    await expect(sweeper.tick()).resolves.toBe(2);
    expect(rows.map((r) => r.id).sort()).toEqual(["grace", "keep"]);
  });

  it("cleans the head blob and every version blob", async () => {
    const { sweeper, deletedBlobs } = await sweeperOver(
      [artifactRow({ id: "a1", expiresAt: daysAgo(10) })],
      { a1: ["library/o1/a1/v0/old.html"] },
    );
    await sweeper.tick();
    expect(deletedBlobs.sort()).toEqual([
      "library/o1/a1/v0/old.html",
      "library/o1/a1/v1/t.html",
    ]);
  });
});
