import { TRPCError } from "@trpc/server";
import type { SatelliteManifest } from "api-server-api";
import { describe, expect, it } from "vitest";
import { createSatelliteWorkerOps } from "../../modules/satellites/services/worker-ops.js";
import { stubFileChannel } from "../helpers/satellite-fakes.js";

/**
 * TEST_OVERVIEW: AC-14. A `dam satellite files` from before the mount registers
 * one Satellite per directory with `download`/`upload` tools that carry a transfer
 * direction, and the platform no longer serves those tools: the Satellite would
 * show an Agent nothing, and its Jobs would never run. The platform refuses such a
 * manifest and says how to fix it, while a manifest from any other worker
 * registers as it always did — including an MCP Satellite whose tool merely
 * happens to be called `download`.
 */

const INCARNATION = "77777777-7777-4777-8777-777777777777";

function harness() {
  const registered: unknown[][] = [];
  const ops = createSatelliteWorkerOps({
    repo: {
      upsertFromManifest: async (...args: unknown[]) => {
        registered.push(args);
        return { incarnation: INCARNATION };
      },
      renewFromManifest: async (...args: unknown[]) => {
        registered.push(args);
        return { incarnation: INCARNATION };
      },
    } as never,
    fileChannel: stubFileChannel(),
    maxConcurrentCeiling: 16,
    deliverOutcome: async () => {},
  });
  return { ops, registered };
}

function manifest(patch: Partial<SatelliteManifest>): SatelliteManifest {
  return {
    name: "lab",
    maxConcurrent: 4,
    tools: [{ name: "run", inputSchema: {} }],
    ...patch,
  } as SatelliteManifest;
}

describe("a files worker from before the mount", () => {
  /**
   * TEST_SCENARIO: Its manifest carries a tool with a transfer direction, which no
   * other worker sends. It is refused with the one action that helps, and nothing
   * is written: registering it would replace a Satellite that serves the mount.
   */
  it("is refused and told to update the CLI", async () => {
    const { ops, registered } = harness();
    const refusal = await ops
      .connect(
        "alice",
        manifest({
          tools: [
            {
              name: "download",
              inputSchema: {},
              transfer: "download",
            },
          ],
        }),
      )
      .catch((err: unknown) => err);

    expect(refusal).toBeInstanceOf(TRPCError);
    if (!(refusal instanceof TRPCError)) return;
    expect(refusal.code).toBe("BAD_REQUEST");
    expect(refusal.message).toContain("update the CLI");
    expect(refusal.message).toContain("dam update");
    expect(registered).toHaveLength(0);
  });

  it("is refused when it resumes a registration it served before", async () => {
    const { ops, registered } = harness();
    await expect(
      ops.connect(
        "alice",
        manifest({
          tools: [{ name: "upload", inputSchema: {}, transfer: "upload" }],
        }),
        "laptop",
        INCARNATION,
      ),
    ).rejects.toBeInstanceOf(TRPCError);
    expect(registered).toHaveLength(0);
  });

  /**
   * TEST_SCENARIO: A tool named after a transfer is not a transfer: only the
   * direction a worker declares marks one, so an MCP server with a `download` tool
   * registers as before.
   */
  it("accepts an MCP manifest whose tool is only named download", async () => {
    const { ops, registered } = harness();
    const registeredNames = await ops.connect(
      "alice",
      manifest({
        tools: [{ name: "download", inputSchema: {} }],
      }),
      "gpu-box",
    );
    expect(registeredNames).toEqual({ incarnation: INCARNATION });
    expect(registered).toHaveLength(1);
  });

  it("accepts a files manifest with no tools", async () => {
    const { ops, registered } = harness();
    const answer = await ops.connect(
      "alice",
      manifest({ kind: "files", tools: [], files: { writable: true } }),
      "laptop",
    );
    expect(answer).toEqual({ incarnation: INCARNATION });
    expect(registered).toHaveLength(1);
  });
});
