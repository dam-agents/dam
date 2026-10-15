import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { AgentRuntimeContext, FilesService } from "agent-runtime-api";
import { appRouter } from "agent-runtime-api/router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFilesService } from "../../modules/files.js";

// TEST_OVERVIEW: The agent's file API answers its owner over HTTP. An error response carries a message and a code but never the server's stack trace, and removing a file that is not there is a not-found error, not an internal one.

describe("file API error responses", () => {
  let work: string;
  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), "files-errors-"));
  });
  afterEach(() => rmSync(work, { recursive: true, force: true }));

  const post = async (
    procedure: string,
    input: unknown,
    files: Partial<FilesService> = createFilesService(work),
  ) => {
    const response = await fetchRequestHandler({
      endpoint: "/trpc",
      req: new Request(`http://localhost/trpc/${procedure}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
      router: appRouter,
      createContext: () => ({ files }) as AgentRuntimeContext,
    });
    const body = (await response.json()) as {
      error: { data: Record<string, unknown> };
    };
    return { status: response.status, data: body.error.data };
  };

  // TEST_SCENARIO: Removing a missing file, or a path under a missing folder, answers 404 NOT_FOUND without a stack.
  it.each(["fill/f0", "gone.txt"])(
    "answers removing missing %s with NOT_FOUND and no stack",
    async (path) => {
      const { status, data } = await post("files.remove", { path });

      expect(status).toBe(404);
      expect(data.code).toBe("NOT_FOUND");
      expect(data).not.toHaveProperty("stack");
    },
  );

  // TEST_SCENARIO: An error the server does not expect is still a 500, and still answers without a stack.
  it("drops the stack from an internal error", async () => {
    const { status, data } = await post(
      "files.remove",
      { path: "x" },
      {
        deleteSafe: async () => {
          throw new Error("disk on fire");
        },
      },
    );

    expect(status).toBe(500);
    expect(data.code).toBe("INTERNAL_SERVER_ERROR");
    expect(data).not.toHaveProperty("stack");
  });
});
