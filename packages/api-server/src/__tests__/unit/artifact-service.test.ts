import { describe, expect, it, vi } from "vitest";

import type { ArtifactStore } from "../../modules/artifacts/domain/artifact-store.js";
import { createArtifactService } from "../../modules/artifacts/services/artifact-service.js";

const MAX = 1024;

function stubStore(overrides: Partial<ArtifactStore> = {}): ArtifactStore {
  return {
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    exists: vi.fn().mockResolvedValue(false),
    head: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(undefined),
    presignUpload: vi.fn().mockResolvedValue(null),
    presignDownload: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe("artifact service — size cap", () => {
  it("put rejects an over-cap blob before it reaches storage", async () => {
    const store = stubStore();
    const service = createArtifactService({ store, maxBytes: MAX });

    await expect(
      service.put({
        key: "k",
        content: Buffer.alloc(MAX + 1),
        contentType: "application/octet-stream",
      }),
    ).rejects.toThrow(/exceeds the maximum size/);
    expect(store.put).not.toHaveBeenCalled();

    await service.put({
      key: "k",
      content: Buffer.alloc(MAX),
      contentType: "application/octet-stream",
    });
    expect(store.put).toHaveBeenCalledTimes(1);
  });
});

describe("artifact service — verifyUpload", () => {
  it("rejects a reference with no uploaded object", async () => {
    const store = stubStore();
    const service = createArtifactService({ store, maxBytes: MAX });

    await expect(service.verifyUpload("ghost")).rejects.toThrow(
      /No uploaded candidate found/,
    );
    expect(store.delete).not.toHaveBeenCalled();
  });

  it("discards and rejects an over-cap upload", async () => {
    const store = stubStore({
      head: vi
        .fn()
        .mockResolvedValue({ contentType: "text/plain", sizeBytes: MAX + 1 }),
    });
    const service = createArtifactService({ store, maxBytes: MAX });

    await expect(service.verifyUpload("big")).rejects.toThrow(
      /exceeds the maximum size .* has been discarded/,
    );
    expect(store.delete).toHaveBeenCalledWith("big");
  });

  it("returns the stat of a within-cap upload", async () => {
    const store = stubStore({
      head: vi
        .fn()
        .mockResolvedValue({ contentType: "text/plain", sizeBytes: MAX }),
    });
    const service = createArtifactService({ store, maxBytes: MAX });

    expect(await service.verifyUpload("ok")).toEqual({
      contentType: "text/plain",
      sizeBytes: MAX,
    });
    expect(store.delete).not.toHaveBeenCalled();
  });
});

describe("artifact service — direct-transfer links", () => {
  it("createUploadUrl passes the TTL through and null means unavailable", async () => {
    const presignUpload = vi.fn().mockResolvedValue("https://store/put/k");
    const service = createArtifactService({
      store: stubStore({ presignUpload }),
      maxBytes: MAX,
    });

    const upload = await service.createUploadUrl("k");
    expect(upload?.url).toBe("https://store/put/k");
    expect(presignUpload).toHaveBeenCalledWith("k", {
      expiresSeconds: upload!.expiresSeconds,
    });

    const none = createArtifactService({ store: stubStore(), maxBytes: MAX });
    expect(await none.createUploadUrl("k")).toBeNull();
  });
});
