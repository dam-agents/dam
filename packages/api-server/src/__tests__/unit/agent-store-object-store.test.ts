import { describe, expect, it, vi } from "vitest";

const sent: Array<Record<string, unknown>> = [];

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    async send(command: { input: Record<string, unknown> }) {
      sent.push(command.input);
      return {
        Body: {
          transformToByteArray: async () => new TextEncoder().encode("archive"),
        },
      };
    }
  },
  GetObjectCommand: class {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  },
}));

const { createObjectStoreReader } =
  await import("../../modules/agent-store/object-store.js");

// TEST_OVERVIEW: The contract gate reads back the object-store copy of the archive, addressed by the s3:// reference the absorb recorded. The bucket is the install's own, so it must be stripped before the read: passing the whole reference as the key asks the store for an object literally named "s3://bucket/key", which never exists and would make every install with an object store refuse to start.

describe("the gate's object-store read", () => {
  // TEST_SCENARIO: The reference the absorb records names the install's bucket and the key below it; the read asks for that key alone, and returns the bytes.
  it("strips the bucket from the reference", async () => {
    sent.length = 0;
    const read = createObjectStoreReader({
      endpoint: "https://store.example.test",
      region: "us-east-1",
      bucket: "platform-artifacts",
      forcePathStyle: true,
      credentials: null,
    });
    const body = await read(
      "s3://platform-artifacts/crd-snapshots/platform/aaa.yaml",
    );
    expect(sent).toEqual([
      { Bucket: "platform-artifacts", Key: "crd-snapshots/platform/aaa.yaml" },
    ]);
    expect(body?.toString("utf8")).toBe("archive");
  });

  // TEST_SCENARIO: A reference to another bucket is not this install's copy; the read answers nothing rather than asking another bucket for it.
  it("refuses a reference to another bucket", async () => {
    sent.length = 0;
    const read = createObjectStoreReader({
      endpoint: "https://store.example.test",
      region: "us-east-1",
      bucket: "platform-artifacts",
      forcePathStyle: true,
      credentials: null,
    });
    expect(await read("s3://someone-else/archive.yaml")).toBeNull();
    expect(sent).toEqual([]);
  });
});
