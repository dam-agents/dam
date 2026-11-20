import type { SatelliteView } from "api-server-api";
import { describe, expect, it, vi } from "vitest";
import type { AgentView } from "../modules/agent/domain/agent-view.js";
import type { AgentService } from "../modules/agent/index.js";
import { buildGrantCommand } from "../modules/satellite/commands/manage.js";
import type { TrpcClient } from "../modules/shared/trpc/trpc-client.js";
import { captureOutput, deps, ok, output, run } from "./connection-commands.js";

/**
 * TEST_OVERVIEW: What `dam satellite grant` tells the user they just did. A tool
 * surface reaches an Agent's harness when that harness next starts, because a
 * harness lists tools once; a file tree does not, because the mount follows the
 * grants while the Agent runs and appears at `/mnt/sat/<name>` within 30 seconds.
 * The message is the only place a user learns which of the two they just granted,
 * so a files Satellite must not be described as a tool list that has to restart.
 */

captureOutput();

const AGENT = {
  id: "agent-00000000000000aa",
  name: "SFF2",
  templateId: null,
  image: "",
  state: "running",
  channels: [],
} as unknown as AgentView;

const satellite = (name: string, kind: SatelliteView["kind"]): SatelliteView =>
  ({
    name,
    kind,
    filesWritable: kind === "files",
    description: null,
    host: "laptop",
    online: true,
    draining: false,
    lastSeenAt: null,
    tools: [],
    maxConcurrent: 16,
    activeJobs: 0,
    grantedAgentIds: [],
  }) as SatelliteView;

function grant(satellites: SatelliteView[]) {
  const mutate = vi.fn(async () => undefined);
  const command = buildGrantCommand(
    {
      ...deps({}, { list: async () => ok([AGENT]) } as Partial<AgentService>),
      createTrpc: () =>
        ({
          satellites: {
            grant: { mutate },
            list: { query: async () => satellites },
          },
        }) as unknown as TrpcClient,
    },
    false,
  );
  return { command, mutate };
}

describe("dam satellite grant", () => {
  /**
   * TEST_SCENARIO: A files Satellite is a mount. Nothing restarts and the path is
   * what the user should look for, so the message names it and the 30 seconds.
   */
  it("says a files Satellite appears at its mount path within 30 seconds", async () => {
    const { command, mutate } = grant([
      satellite("lab", "files"),
      satellite("gpu-box", "tools"),
    ]);
    await run(command, ["lab", "SFF2"]);

    expect(mutate).toHaveBeenCalledWith({
      satellite: "lab",
      agentId: AGENT.id,
    });
    expect(output.stderr).toContain(
      "SFF2 can now reach lab. It appears at /mnt/sat/lab within 30 seconds, with no restart.\n",
    );
    expect(output.stderr).not.toContain("picks the tools up");
  });

  /**
   * TEST_SCENARIO: A tool surface is what it always was: the harness picks the
   * tools up when it next starts, and the message keeps saying so.
   */
  it("keeps the tools wording for a tool surface", async () => {
    const { command } = grant([satellite("gpu-box", "tools")]);
    await run(command, ["gpu-box", "SFF2"]);

    expect(output.stderr).toContain(
      "SFF2 can now reach gpu-box. Its harness picks the tools up when it next starts.\n",
    );
    expect(output.stderr).not.toContain("/mnt/sat");
  });
});
