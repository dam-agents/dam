// TEST_OVERVIEW: `dam artifact share` lets a person, or their own agent, manage who can open an artifact from a terminal. Without flags it only reads the artifact and prints its level, link and viewers. `--add` adds viewers and makes the artifact restricted, `--remove` takes viewers off and keeps the level, and `--private` closes the link; each change is one sharing write that names only the emails to add or remove, so the server keeps the rest of the list. An email the server would refuse, or `--private` with `--add`, fails before any call.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryArtifact } from "api-server-api";
import { buildShareCommand } from "../modules/artifact/commands/share.js";
import type { ArtifactService } from "../modules/artifact/services/artifact-service.js";
import {
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../modules/shared/exit-codes.js";

const ok = <T>(value: T) => ({ ok: true as const, value });

const deps = (svc: Partial<ArtifactService>) => ({
  compatService: {
    check: async () =>
      ok({
        kind: "ok" as const,
        localCli: "1.0.0",
        serverVersion: "1.0.0",
        serverMinClient: undefined,
        serverRecommendedClient: undefined,
      }),
  },
  configService: {
    getResolved: async () => ok({ server: "http://localhost:4444" }),
    set: vi.fn(),
  },
  createArtifactService: () => svc as ArtifactService,
});

let stdout = "";
let stderr = "";

async function run(
  svc: Partial<ArtifactService>,
  args: string[],
  code = EXIT_SUCCESS,
) {
  stdout = "";
  stderr = "";
  await expect(
    buildShareCommand(deps(svc)).parseAsync(args, { from: "user" }),
  ).rejects.toThrow(`exit ${code}`);
  return stdout;
}

beforeEach(() => {
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`exit ${code}`);
  });
  vi.spyOn(process.stdout, "write").mockImplementation(
    (chunk: unknown, done?: unknown) => {
      stdout += String(chunk);
      if (typeof done === "function") (done as () => void)();
      return true;
    },
  );
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderr += String(chunk);
    return true;
  });
});

afterEach(() => vi.restoreAllMocks());

function artifact(overrides: Partial<LibraryArtifact>): LibraryArtifact {
  return {
    id: "art-1",
    title: "Quarterly report",
    slug: "slug-1",
    kind: "markdown",
    contentType: "text/markdown",
    fileName: "report.md",
    sizeBytes: 6,
    version: 1,
    folderId: null,
    sourcePath: null,
    agentId: "agent-1",
    visibility: "restricted",
    interactive: false,
    expiresAt: null,
    viewCount: 0,
    shareUrl: "https://share.example.com/a/slug-1",
    viewers: ["ada@example.com", "bob@example.com"],
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("dam artifact share", () => {
  // TEST_SCENARIO: the user asks who can see an artifact; with no flags the command reads it and changes nothing.
  it("shows the level, the link and the viewers without changing anything", async () => {
    const get = vi.fn(async () => ok(artifact({})));
    const setSharing = vi.fn();
    const out = await run({ get, setSharing }, ["art-1"]);
    expect(get).toHaveBeenCalledWith("art-1");
    expect(setSharing).not.toHaveBeenCalled();
    expect(out).toBe(
      "Quarterly report is restricted: only you and its viewers can open https://share.example.com/a/slug-1.\n" +
        "Viewers:\n  ada@example.com\n  bob@example.com\n",
    );
  });

  // TEST_SCENARIO: sharing with colleagues sends only the normalised emails to add, with restricted, so the server keeps everyone already on the list.
  it("adds viewers and makes the artifact restricted", async () => {
    const setSharing = vi.fn(async () => ok(artifact({})));
    await run({ setSharing }, [
      "art-1",
      "--add",
      " Ada@Example.com ",
      "--add",
      "bob@example.com",
    ]);
    expect(setSharing).toHaveBeenCalledWith("art-1", {
      visibility: "restricted",
      addViewers: ["ada@example.com", "bob@example.com"],
    });
  });

  // TEST_SCENARIO: removing a person keeps the artifact at its level, and --private closes the link; the JSON output carries the viewers.
  it("removes viewers at the same level, and makes the artifact private", async () => {
    const setSharing = vi.fn(async () =>
      ok(artifact({ viewers: ["ada@example.com"] })),
    );
    const out = await run({ setSharing }, [
      "art-1",
      "--remove",
      "bob@example.com",
      "--json",
    ]);
    expect(setSharing).toHaveBeenLastCalledWith("art-1", {
      removeViewers: ["bob@example.com"],
    });
    expect(JSON.parse(out)).toMatchObject({
      visibility: "restricted",
      viewers: ["ada@example.com"],
    });
    await run({ setSharing }, ["art-1", "--private"]);
    expect(setSharing).toHaveBeenLastCalledWith("art-1", {
      visibility: "private",
    });
  });

  // TEST_SCENARIO: input the server would refuse fails before any call, with the flag named.
  it("refuses a bad email, and --private with --add, before calling the server", async () => {
    const setSharing = vi.fn();
    await run({ setSharing }, ["art-1", "--add", "ada"], EXIT_INVALID_INPUT);
    expect(stderr).toContain('--add takes an email address, not "ada"');
    await run(
      { setSharing },
      ["art-1", "--private", "--add", "ada@example.com"],
      EXIT_INVALID_INPUT,
    );
    expect(stderr).toContain("--private cannot be used with --add");
    expect(setSharing).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: the server refuses to add viewers to an interactive page; the command prints the server's reason and exits non-zero.
  it("prints the server's refusal", async () => {
    const setSharing = vi.fn(async () => ({
      ok: false as const,
      error: {
        kind: "transport" as const,
        reason:
          "Only the owner shares it with named people, in the app's Share dialog.",
        serverCode: "FORBIDDEN",
      },
    }));
    await run(
      { setSharing },
      ["art-1", "--add", "ada@example.com"],
      EXIT_RUNTIME_FAILURE,
    );
    expect(stderr).toContain("in the app's Share dialog");
  });
});
