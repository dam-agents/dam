import { afterEach, beforeEach, expect, vi } from "vitest";
import type { ConnectionView, GitHubUserTokenProbe } from "api-server-api";
import type { AgentService } from "../modules/agent/index.js";
import type { ConnectionService } from "../modules/connection/services/connection-service.js";
import { EXIT_SUCCESS } from "../modules/shared/exit-codes.js";

export const view = (over: Partial<ConnectionView>): ConnectionView => ({
  id: "conn-x",
  ownerId: "user-1",
  templateId: "github",
  category: "app",
  name: "x",
  status: "active",
  authKind: "oauth",
  contributions: [],
  hosts: [],
  ...over,
});

export const signIn = view({
  id: "conn-signin",
  name: "github",
  hosts: ["github.com"],
  isParent: true,
  githubUserToken: {},
});
export const fullChild = view({
  id: "conn-gh",
  name: "github",
  hosts: ["github.com"],
  parentId: "conn-signin",
  fullAccess: true,
  githubUserToken: {},
});
export const narrowedChild = view({
  id: "conn-gh",
  name: "github",
  hosts: ["github.com"],
  parentId: "conn-signin",
  githubUserToken: {
    scope: {
      targetId: 11,
      targetLogin: "acme",
      repositoryIds: [101],
      permissions: { contents: "read" },
    },
  },
});
export const docsChild = view({
  id: "conn-docs",
  name: "github-docs",
  hosts: ["github.com"],
  parentId: "conn-signin",
  githubUserToken: {
    scope: {
      targetId: 11,
      targetLogin: "acme",
      repositoryIds: [102],
      repositoryNames: ["web"],
    },
  },
});
export const installation = view({
  id: "conn-inst",
  name: "my-app",
  templateId: "github-app",
  authKind: "github-app",
  isParent: true,
});
export const app = view({
  id: "conn-app",
  name: "my-app",
  templateId: "github-app",
  authKind: "github-app",
  parentId: "conn-inst",
  githubAppScope: {
    repositories: ["api"],
    permissions: { issues: "write" },
  },
});
export const slack = view({
  id: "conn-slack",
  name: "slack",
  templateId: "slack",
});

export const probe: GitHubUserTokenProbe = {
  installations: [
    {
      installationId: 1,
      targetId: 11,
      accountLogin: "acme",
      permissions: { contents: "write", pull_requests: "write" },
      repositorySelection: "selected",
      repositories: [
        { id: 101, name: "api" },
        { id: 102, name: "web" },
      ],
    },
    {
      installationId: 2,
      targetId: 22,
      accountLogin: "octo",
      permissions: { contents: "read" },
      repositorySelection: "all",
      repositories: [{ id: 201, name: "dotfiles" }],
    },
  ],
};

export const deps = (
  svc: Partial<ConnectionService>,
  agents?: Partial<AgentService>,
) => ({
  compatService: {
    check: async () => ({
      ok: true as const,
      value: {
        kind: "ok" as const,
        localCli: "1.0.0",
        serverVersion: "1.0.0",
        serverMinClient: undefined,
        serverRecommendedClient: undefined,
      },
    }),
  },
  configService: {
    getResolved: async () => ({
      ok: true as const,
      value: { server: "http://localhost:4444" },
    }),
    set: vi.fn(),
  },
  createAgentService: () => {
    if (!agents) throw new Error("no agent lookup expected");
    return agents as AgentService;
  },
  createConnectionService: () => svc as ConnectionService,
  browserOpener: {
    open: async () => ({ ok: true as const, value: undefined }),
  },
});

export const output = { stdout: "", stderr: "" };

export async function run(
  command: { parseAsync: (a: string[], o: { from: "user" }) => unknown },
  args: string[],
  code = EXIT_SUCCESS,
) {
  output.stdout = "";
  output.stderr = "";
  await expect(command.parseAsync(args, { from: "user" })).rejects.toThrow(
    `exit ${code}`,
  );
  return output.stdout;
}

export function captureOutput(): void {
  beforeEach(() => {
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`exit ${code}`);
    });
    vi.spyOn(process.stdout, "write").mockImplementation(
      (chunk: unknown, done?: unknown) => {
        output.stdout += String(chunk);
        if (typeof done === "function") (done as () => void)();
        return true;
      },
    );
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      output.stderr += String(chunk);
      return true;
    });
  });

  afterEach(() => vi.restoreAllMocks());
}

export const ok = <T>(value: T) => ({ ok: true as const, value });

export const FULL_SIGN_IN =
  "FULL ACCESS — every account, repository and permission the sign-in reaches";
