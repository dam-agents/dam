import type { Workspace, WorkspaceMember, WorkspaceRole } from "api-server-api";
import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SectionLabel } from "@/components/ui/section-label";
import { Select } from "@/components/ui/select";

import {
  useCreateWorkspace,
  useRemoveWorkspaceMember,
  useSetWorkspaceMember,
} from "../api/mutations.js";
import { useWorkspaceMembers, useWorkspaces } from "../api/queries.js";
import {
  currentWorkspaceId,
  switchWorkspace,
} from "../lib/current-workspace.js";

const ROLES: readonly { value: WorkspaceRole; label: string }[] = [
  { value: "admin", label: "Admin — manages members, secrets and connections" },
  { value: "editor", label: "Editor — creates and edits agents" },
  { value: "reader", label: "Reader — talks to agents" },
];

export function WorkspacesTab() {
  const { data: workspaces } = useWorkspaces();
  const selectedId = currentWorkspaceId();
  const current = workspaces?.find((w) => w.id === selectedId);

  return (
    <div className="anim-in max-w-2xl">
      <PageHeader
        title="Workspaces"
        description="A shared workspace owns its own agents, connections, schedules and budget. Members see what the workspace owns, limited by their role."
      />
      {current ? (
        <MembersSection workspace={current} />
      ) : (
        <p className="mb-8 text-sm text-muted-foreground">
          You are in your personal workspace. Switch to a shared workspace to
          manage its members.
        </p>
      )}
      <CreateWorkspaceSection />
    </div>
  );
}

function CreateWorkspaceSection() {
  const createWorkspace = useCreateWorkspace();
  const [name, setName] = useState("");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    createWorkspace.mutate(
      { name: trimmed },
      { onSuccess: (created) => switchWorkspace(created.id) },
    );
  }

  return (
    <>
      <SectionLabel spaced>New workspace</SectionLabel>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          aria-label="Workspace name"
          placeholder="Workspace name"
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
        />
        <Button
          type="submit"
          disabled={!name.trim() || createWorkspace.isPending}
        >
          Create
        </Button>
      </form>
    </>
  );
}

function MembersSection({ workspace }: { workspace: Workspace }) {
  const isAdmin = workspace.role === "admin";
  const { data: members, isLoading } = useWorkspaceMembers(workspace.id);

  return (
    <div className="mb-8">
      <SectionLabel spaced>Members of {workspace.name}</SectionLabel>
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      <ul className="space-y-2">
        {members?.map((m) => (
          <MemberRow
            key={m.email}
            workspaceId={workspace.id}
            member={m}
            editable={isAdmin}
          />
        ))}
      </ul>
      {isAdmin && <AddMemberForm workspaceId={workspace.id} />}
    </div>
  );
}

function MemberRow({
  workspaceId,
  member,
  editable,
}: {
  workspaceId: string;
  member: WorkspaceMember;
  editable: boolean;
}) {
  const setMember = useSetWorkspaceMember();
  const removeMember = useRemoveWorkspaceMember();

  return (
    <li>
      <Card className="flex items-center gap-3 p-3">
        <span className="flex-1 truncate text-sm text-foreground">
          {member.email}
        </span>
        {editable ? (
          <>
            <div className="w-32">
              <Select
                size="sm"
                aria-label={`Role of ${member.email}`}
                value={member.role}
                disabled={setMember.isPending}
                onChange={(e) =>
                  setMember.mutate({
                    workspaceId,
                    email: member.email,
                    role: e.target.value as WorkspaceRole,
                  })
                }
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.value}
                  </option>
                ))}
              </Select>
            </div>
            <Button
              variant="ghost"
              tone="danger"
              size="sm"
              disabled={removeMember.isPending}
              onClick={() =>
                removeMember.mutate({ workspaceId, email: member.email })
              }
            >
              Remove
            </Button>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">{member.role}</span>
        )}
      </Card>
    </li>
  );
}

function AddMemberForm({ workspaceId }: { workspaceId: string }) {
  const setMember = useSetWorkspaceMember();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("reader");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setMember.mutate(
      { workspaceId, email: trimmed, role },
      { onSuccess: () => setEmail("") },
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 flex gap-2">
      <Input
        type="email"
        aria-label="Member email"
        placeholder="name@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <div className="w-72 shrink-0">
        <Select
          aria-label="Role"
          value={role}
          onChange={(e) => setRole(e.target.value as WorkspaceRole)}
        >
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
      </div>
      <Button type="submit" disabled={!email.trim() || setMember.isPending}>
        Add
      </Button>
    </form>
  );
}
