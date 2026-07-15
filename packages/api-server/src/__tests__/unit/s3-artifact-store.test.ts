import {
  BucketAlreadyOwnedByYou,
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";

import {
  createS3ArtifactStore,
  ensureBucket,
} from "../../modules/artifacts/infrastructure/s3-artifact-store.js";

/** Stub S3Client: a `send` mock is all the adapter's data path touches. */
function stubClient(send: ReturnType<typeof vi.fn>): S3Client {
  return { send } as unknown as S3Client;
}

/** Real client for the presign paths — presigning is offline crypto, no
 *  network involved, but it needs a fully-constructed client. */
function signerClient(endpoint: string): S3Client {
  return new S3Client({
    endpoint,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId: "ak", secretAccessKey: "sk" },
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
}

function makeStore(
  send: ReturnType<typeof vi.fn>,
  opts?: { downloadSigner?: S3Client | null },
) {
  return createS3ArtifactStore({
    client: stubClient(send),
    bucket: "artifacts",
    uploadSigner: signerClient("http://agents-view:8333"),
    downloadSigner:
      opts?.downloadSigner === undefined
        ? signerClient("http://public-view:8333")
        : opts.downloadSigner,
  });
}

const noSuchKey = () =>
  new NoSuchKey({ $metadata: {}, message: "no such key" });
const notFound = () => new NotFound({ $metadata: {}, message: "not found" });

describe("createS3ArtifactStore", () => {
  it("put writes the blob as an object with its content type", async () => {
    const send = vi.fn().mockResolvedValue({});
    const store = makeStore(send);

    await store.put({
      key: "exp/agent/run/candidate.json",
      content: Buffer.from("{}"),
      contentType: "application/json",
    });

    expect(send).toHaveBeenCalledTimes(1);
    const cmd = send.mock.calls[0]![0] as PutObjectCommand;
    expect(cmd).toBeInstanceOf(PutObjectCommand);
    expect(cmd.input).toMatchObject({
      Bucket: "artifacts",
      Key: "exp/agent/run/candidate.json",
      ContentType: "application/json",
    });
  });

  it("get returns the blob with metadata mapped from the object", async () => {
    const lastModified = new Date("2026-07-01T00:00:00Z");
    const send = vi.fn().mockResolvedValue({
      Body: { transformToByteArray: () => Promise.resolve(Buffer.from("hi")) },
      ContentType: "text/plain",
      LastModified: lastModified,
    });
    const store = makeStore(send);

    const artifact = await store.get("k");

    expect(send.mock.calls[0]![0]).toBeInstanceOf(GetObjectCommand);
    expect(artifact).toMatchObject({
      key: "k",
      contentType: "text/plain",
      sizeBytes: 2,
      createdAt: lastModified,
    });
    expect(artifact?.content.toString()).toBe("hi");
  });

  it("get returns null for a missing key", async () => {
    const send = vi.fn().mockRejectedValue(noSuchKey());
    expect(await makeStore(send).get("missing")).toBeNull();
  });

  it("get rethrows non-missing errors", async () => {
    const send = vi.fn().mockRejectedValue(new Error("connection refused"));
    await expect(makeStore(send).get("k")).rejects.toThrow(
      "connection refused",
    );
  });

  it("exists maps a HeadObject hit/miss to true/false", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(notFound());
    const store = makeStore(send);

    expect(await store.exists("present")).toBe(true);
    expect(await store.exists("absent")).toBe(false);
    expect(send.mock.calls[0]![0]).toBeInstanceOf(HeadObjectCommand);
  });

  it("head returns metadata without the content, null on miss", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ ContentType: "text/csv", ContentLength: 12 })
      .mockRejectedValueOnce(notFound());
    const store = makeStore(send);

    expect(await store.head("present")).toEqual({
      contentType: "text/csv",
      sizeBytes: 12,
    });
    expect(await store.head("absent")).toBeNull();
  });

  it("delete issues an idempotent DeleteObject", async () => {
    const send = vi.fn().mockResolvedValue({});
    await makeStore(send).delete("k");
    expect(send.mock.calls[0]![0]).toBeInstanceOf(DeleteObjectCommand);
  });

  it("presignUpload signs a PUT for the exact key against the agent-facing authority", async () => {
    const store = makeStore(vi.fn());
    const url = await store.presignUpload("exp/agent/u/c.bin", {
      expiresSeconds: 900,
    });
    const parsed = new URL(url!);
    expect(parsed.host).toBe("agents-view:8333");
    expect(parsed.pathname).toBe("/artifacts/exp/agent/u/c.bin");
    expect(parsed.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(parsed.searchParams.get("X-Amz-Signature")).toBeTruthy();
    // The SDK default checksum injection would bake an empty-body CRC into
    // the URL and every real upload would fail BadDigest.
    expect(parsed.searchParams.get("x-amz-checksum-crc32")).toBeNull();
  });

  it("presignDownload signs a GET with attachment disposition against the public authority", async () => {
    const store = makeStore(vi.fn());
    const url = await store.presignDownload("exp/agent/u/c.bin", {
      filename: "c.bin",
      expiresSeconds: 60,
    });
    const parsed = new URL(url!);
    expect(parsed.host).toBe("public-view:8333");
    expect(parsed.searchParams.get("response-content-disposition")).toBe(
      'attachment; filename="c.bin"',
    );
  });

  it("presignDownload returns null with no browser-reachable endpoint", async () => {
    const store = makeStore(vi.fn(), { downloadSigner: null });
    expect(
      await store.presignDownload("k", { filename: "k", expiresSeconds: 60 }),
    ).toBeNull();
  });
});

describe("ensureBucket", () => {
  it("no-ops when the bucket already exists", async () => {
    const send = vi.fn().mockResolvedValue({});
    await ensureBucket(stubClient(send), "artifacts");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toBeInstanceOf(HeadBucketCommand);
  });

  it("creates the bucket when missing", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(notFound())
      .mockResolvedValueOnce({});
    await ensureBucket(stubClient(send), "artifacts");
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]![0]).toBeInstanceOf(CreateBucketCommand);
  });

  it("treats a concurrent create by another replica as success", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(notFound())
      .mockRejectedValueOnce(
        new BucketAlreadyOwnedByYou({ $metadata: {}, message: "owned" }),
      );
    await expect(ensureBucket(stubClient(send), "artifacts")).resolves.toBe(
      undefined,
    );
  });

  it("propagates a create failure (restricted credentials)", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(notFound())
      .mockRejectedValueOnce(new Error("AccessDenied"));
    await expect(ensureBucket(stubClient(send), "artifacts")).rejects.toThrow(
      "AccessDenied",
    );
  });

  it("propagates a head failure that is not bucket-missing", async () => {
    const send = vi.fn().mockRejectedValue(new Error("connection refused"));
    await expect(ensureBucket(stubClient(send), "artifacts")).rejects.toThrow(
      "connection refused",
    );
  });
});
