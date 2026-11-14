// TEST_OVERVIEW: An upload the server refuses for its size names the install's cap, which the browser learns only from the refusal: the message reads "the limit is 50 MiB", not "File is too large" alone.
import { expect, it, vi } from "vitest";

vi.mock("../../auth.js", () => ({
  getAccessToken: async () => "token",
}));
vi.mock("../../lib/toast.js", () => ({ emitToast: vi.fn() }));

const { uploadArtifactFile } =
  await import("../../modules/artifacts/lib/transfer.js");

const refusal = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 413,
    headers: { "content-type": "application/json" },
  });

const uploaded = (file: File): Promise<string> =>
  uploadArtifactFile(file).catch((e: Error) => e.message);

// TEST_SCENARIO: the file is over the install's cap, and the server answers 413 with the cap in the body; the person reads which limit they passed.
it("names the cap the refusal carries", async () => {
  vi.stubGlobal("fetch", async () => refusal({ maxBytes: 50 * 1024 * 1024 }));

  expect(await uploaded(new File(["x"], "big.bin"))).toContain(
    "the limit is 50 MiB",
  );
});

// TEST_SCENARIO: a refusal with no cap in it is still a refusal; the message then says only that the file is too large, rather than inventing a limit the install may not have.
it("says only that the file is too large when no cap comes with it", async () => {
  vi.stubGlobal("fetch", async () => refusal({ error: "too large" }));

  expect(await uploaded(new File(["x"], "big.bin"))).toBe("File is too large");
});
