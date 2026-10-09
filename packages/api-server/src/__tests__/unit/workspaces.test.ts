// TEST_OVERVIEW: A workspace is a shared owner. Membership is checked by verified login email, the member's role narrows the request's scopes, only admins change members, and a workspace always keeps one admin.
import { describe, expect, it } from "vitest";
import type {
  ApiContext,
  UserIdentity,
  Workspace,
  WorkspaceMember,
  WorkspaceRole,
} from "api-server-api";
import { ALL_SCOPES, workspacePrincipal } from "api-server-api";
import { appRouter } from "api-server-api/router";
import { markTermsProven } from "api-server-api/trpc";
import type { WorkspacesRepository } from "../../modules/workspaces/infrastructure/workspaces-repository.js";
import { createWorkspaceAccessResolver } from "../../modules/workspaces/services/workspace-access.js";
import { createWorkspacesService } from "../../modules/workspaces/services/workspaces-service.js";
import { scopeToWorkspace } from "../../modules/workspaces/index.js";
import { resolveRequestedWorkspace } from "../../apps/api-server/trpc/workspace-header.js";

const WS = "11111111-1111-4111-8111-111111111111";

function memoryRepo(): WorkspacesRepository {
  const names = new Map<string, string>();
  const members = new Map<string, Map<string, WorkspaceRole>>();
  const of = (id: string) => members.get(id) ?? new Map();
  return {
    async listForEmail(email) {
      const out: Workspace[] = [];
      for (const [id, m] of members) {
        const role = m.get(email);
        if (role) out.push({ id, name: names.get(id)!, role });
      }
      return out;
    },
    async create({ id, name, adminEmail }) {
      names.set(id, name);
      members.set(id, new Map([[adminEmail, "admin"]]));
    },
    async roleOf(id, email) {
      return of(id).get(email) ?? null;
    },
    async members(id): Promise<WorkspaceMember[]> {
      return [...of(id)].map(([email, role]) => ({
        email,
        role,
        addedAt: "2026-10-09T00:00:00.000Z",
      }));
    },
    async upsertMember({ workspaceId, email, role }) {
      members.set(workspaceId, of(workspaceId).set(email, role));
    },
    async removeMember(id, email) {
      of(id).delete(email);
    },
    async countAdmins(id) {
      return [...of(id).values()].filter((r) => r === "admin").length;
    },
  };
}

const person = (sub: string, email?: string, keyId?: string): UserIdentity => ({
  sub,
  preferredUsername: sub,
  ...(email ? { email } : {}),
  scopes: ALL_SCOPES,
  agentIds: "*",
  ...(keyId ? { keyId } : {}),
});

async function seeded() {
  const repo = memoryRepo();
  await repo.create({
    id: WS,
    name: "Team",
    createdBy: "alice-sub",
    adminEmail: "alice@example.com",
  });
  await repo.upsertMember({
    workspaceId: WS,
    email: "bob@example.com",
    role: "reader",
    addedBy: "alice-sub",
  });
  return repo;
}

describe("workspace access", () => {
  it("gives a member the workspace principal and their role", async () => {
    const access = createWorkspaceAccessResolver(await seeded());
    await expect(
      access.resolve(person("bob-sub", "bob@example.com"), WS),
    ).resolves.toEqual({
      id: WS,
      principal: workspacePrincipal(WS),
      role: "reader",
    });
  });

  // TEST_SCENARIO: An API key carries no login email, so it must never act in a workspace even when its owner is a member.
  it("refuses non-members, logins without an email, and API keys", async () => {
    const access = createWorkspaceAccessResolver(await seeded());
    await expect(
      access.resolve(person("eve-sub", "eve@example.com"), WS),
    ).resolves.toBeNull();
    await expect(access.resolve(person("bob-sub"), WS)).resolves.toBeNull();
    await expect(
      access.resolve(person("bob-sub", "bob@example.com", "key-1"), WS),
    ).resolves.toBeNull();
  });

  it("lets members reach the workspace's agents and owners reach their own", async () => {
    const access = createWorkspaceAccessResolver(await seeded());
    const bob = person("bob-sub", "bob@example.com");
    await expect(
      access.canReachOwner(bob, workspacePrincipal(WS)),
    ).resolves.toBe(true);
    await expect(access.canReachOwner(bob, "bob-sub")).resolves.toBe(true);
    await expect(access.canReachOwner(bob, "alice-sub")).resolves.toBe(false);
    await expect(
      access.canReachOwner(
        person("eve-sub", "eve@example.com"),
        workspacePrincipal(WS),
      ),
    ).resolves.toBe(false);
  });

  it.each([
    ["reader", ["agents:read", "agents:operate"]],
    [
      "editor",
      ["agents:read", "agents:operate", "agents:manage", "credentials:read"],
    ],
    [
      "admin",
      [
        "agents:read",
        "agents:operate",
        "agents:manage",
        "credentials:read",
        "credentials:manage",
      ],
    ],
  ] as const)("narrows a %s to its scopes", (role, scopes) => {
    const scoped = scopeToWorkspace(person("x", "x@example.com"), {
      id: WS,
      principal: workspacePrincipal(WS),
      role,
    });
    expect([...scoped.scopes].sort()).toEqual([...scopes].sort());
  });

  it("refuses a workspace header from a non-member with FORBIDDEN", async () => {
    const access = createWorkspaceAccessResolver(await seeded());
    await expect(
      resolveRequestedWorkspace(
        access,
        person("eve-sub", "eve@example.com"),
        WS,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      resolveRequestedWorkspace(
        access,
        person("eve-sub", "eve@example.com"),
        "not-a-uuid",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      resolveRequestedWorkspace(access, person("eve-sub"), undefined),
    ).resolves.toBeUndefined();
  });
});

describe("workspace members", () => {
  const service = (repo: WorkspacesRepository, sub: string, email: string) =>
    createWorkspacesService({ repo, actorSub: sub, actorEmail: email });

  it("makes the creator the admin", async () => {
    const repo = memoryRepo();
    const ws = await service(repo, "alice-sub", "alice@example.com").create(
      "Team",
    );
    expect(ws.role).toBe("admin");
    await expect(repo.roleOf(ws.id, "alice@example.com")).resolves.toBe(
      "admin",
    );
  });

  it("lets only an admin change members", async () => {
    const repo = await seeded();
    await expect(
      service(repo, "bob-sub", "bob@example.com").setMember(
        WS,
        "eve@example.com",
        "admin",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await service(repo, "alice-sub", "alice@example.com").setMember(
      WS,
      "eve@example.com",
      "editor",
    );
    await expect(repo.roleOf(WS, "eve@example.com")).resolves.toBe("editor");
  });

  it("hides the workspace from a non-member", async () => {
    const repo = await seeded();
    await expect(
      service(repo, "eve-sub", "eve@example.com").members(WS),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("keeps at least one admin", async () => {
    const repo = await seeded();
    const alice = service(repo, "alice-sub", "alice@example.com");
    await expect(
      alice.removeMember(WS, "alice@example.com"),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      alice.setMember(WS, "alice@example.com", "reader"),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

describe("workspaces router", () => {
  it("refuses API keys", async () => {
    const ctx = {
      user: person("alice-sub", undefined, "key-1"),
      workspaces: { list: async () => [] },
    } as unknown as ApiContext;
    markTermsProven(ctx);
    await expect(
      appRouter.createCaller(ctx).workspaces.list(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses an agent change to a workspace reader", async () => {
    const reader = scopeToWorkspace(person("bob-sub", "bob@example.com"), {
      id: WS,
      principal: workspacePrincipal(WS),
      role: "reader",
    });
    const ctx = {
      user: reader,
      agents: {
        delete: async () => {
          throw new Error("the service must not be reached");
        },
      },
    } as unknown as ApiContext;
    markTermsProven(ctx);
    await expect(
      appRouter.createCaller(ctx).agents.delete({ id: "agent-1" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
