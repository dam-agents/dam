import type { EnvironmentView } from "api-server-api";
import { useState } from "react";

import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { emitToast } from "@/lib/toast";

import { useStore } from "../../../store.js";
import { useAgent } from "../../agents/api/queries.js";
import { ViewerListEditor } from "../../artifacts/components/viewer-list-editor.js";
import { sameViewers } from "../../artifacts/lib/viewer-allowlist.js";
import { useSetEnvironmentMembers } from "../api/mutations.js";
import { NEVER_DELETED, sharedThroughAgent } from "../lib/environment-list.js";
import { AgentMembersEditor, useAgentEdits } from "./agent-members-editor.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The owner's Share dialog for one Environment. It
 * says who opens it through its agent — the owner, the agent's editors and how
 * many people the agent's page names — and links there, and edits the
 * Environment's own members, people and Agents, who open this one Environment
 * only. One kept with no expiry says it is never deleted. The lists only add: nobody here narrows the agent's. An Environment is never
 * public, so there is no link to copy beyond its addresses. It holds the
 * owner's edits as people and Agents added and removed, applied to the members
 * the list polls, so a member added elsewhere while it is open shows up and
 * stays through a Save.
 */
export function EnvironmentShareDialog({
  environment,
  onClose,
}: {
  environment: EnvironmentView;
  onClose: () => void;
}) {
  const agent = useAgent(environment.owningAgentId);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const save = useSetEnvironmentMembers();
  const [edits, setEdits] = useState<MemberEdits>(NO_EDITS);
  const [draft, setDraft] = useState("");
  const agentEdits = useAgentEdits(environment.memberAgents);
  const [agentDraft, setAgentDraft] = useState("");
  const members = applyEdits(environment.members, edits);
  const memberAgents = agentEdits.agents;
  const dirty = !sameViewers(members, environment.members) || agentEdits.dirty;
  const pendingDraft = draft.trim().length > 0 || agentDraft.trim().length > 0;
  const agentName = agent?.name ?? "its agent";

  const onSave = () =>
    save.mutate(
      {
        id: environment.id,
        emails: members,
        agentIds: memberAgents.map((a) => a.agentId),
      },
      {
        onSuccess: (saved) => {
          setEdits(NO_EDITS);
          agentEdits.reset();
          emitToast({
            kind: "success",
            message: `Sharing updated — ${ownMembersPhrase(saved.members.length, saved.memberAgents.length)} ${environment.name}.`,
          });
          onClose();
        },
      },
    );

  return (
    <Modal onClose={save.isPending ? undefined : onClose}>
      <DialogHeader
        title={`Share “${environment.name}”`}
        onClose={onClose}
        closeDisabled={save.isPending}
      />
      <DialogBody>
        <div className="flex flex-col gap-4">
          {environment.expiresAt === null && (
            <p
              className="text-sm text-muted-foreground"
              data-testid="environment-never-deleted"
            >
              {NEVER_DELETED} — it is kept until you or {agentName} delete it.
            </p>
          )}
          <div
            className="flex flex-col gap-1"
            data-testid="environment-shared-through-agent"
          >
            <p className="text-sm text-foreground">
              {sharedThroughAgent({
                agentName,
                editorCount: agent?.access.editors.length ?? 0,
                agentMemberCount: environment.agentMemberCount,
              })}
            </p>
            <p className="text-sm text-muted-foreground">
              The people named on {agentName}&apos;s page open every Environment
              it creates.{" "}
              <button
                type="button"
                className="text-accent hover:underline"
                onClick={() => {
                  onClose();
                  navigateToSandboxHome(
                    environment.owningAgentId,
                    "environments",
                  );
                }}
              >
                Change them there
              </button>
              .
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-foreground">
              Also open to, for this Environment only
            </p>
            <ViewerListEditor
              viewers={members}
              onChange={(next) =>
                setEdits(editsBetween(environment.members, next))
              }
              disabled={save.isPending}
              draft={draft}
              onDraftChange={setDraft}
              inputLabel="Member email address"
              {...(members.length === 0 && {
                caption:
                  "Nobody else yet. Add a person who should open this one.",
              })}
            />
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-foreground">
              Agents that may open it
            </p>
            <p className="text-xs text-muted-foreground">
              An agent you add opens this Environment from its own sandbox, as
              itself. It shares nothing with that agent&apos;s owner.
            </p>
            <AgentMembersEditor
              agents={memberAgents}
              onAdd={agentEdits.onAdd}
              onRemove={agentEdits.onRemove}
              disabled={save.isPending}
              draft={agentDraft}
              onDraftChange={setAgentDraft}
            />
          </div>
          {pendingDraft && (
            <p role="status" className="text-xs text-muted-foreground">
              Add what you typed to its list or clear it before saving.
            </p>
          )}
        </div>
      </DialogBody>
      <DialogActions
        onCancel={onClose}
        cancelLabel="Close"
        label="Save"
        pendingLabel="Saving…"
        pending={save.isPending}
        cancelDisabled={save.isPending}
        disabled={!dirty || pendingDraft}
        onSubmit={onSave}
      />
    </Modal>
  );
}

interface MemberEdits {
  added: readonly string[];
  removed: readonly string[];
}

const NO_EDITS: MemberEdits = { added: [], removed: [] };

// UNIT_BOUNDARY_DESCRIPTION: the edits that turn the members as polled into the list the owner now sees.
function editsBetween(
  live: readonly string[],
  next: readonly string[],
): MemberEdits {
  return {
    added: next.filter((e) => !live.includes(e)),
    removed: live.filter((e) => !next.includes(e)),
  };
}

// UNIT_BOUNDARY_DESCRIPTION: the members as polled, with the owner's edits applied, so a later poll keeps a person someone else added.
function applyEdits(live: readonly string[], edits: MemberEdits): string[] {
  return [
    ...live.filter((e) => !edits.removed.includes(e)),
    ...edits.added.filter((e) => !live.includes(e)),
  ];
}

// UNIT_BOUNDARY_DESCRIPTION: who of the Environment's own may open it after a save, its people and its agents counted apart.
export function ownMembersPhrase(people: number, agents: number): string {
  if (people === 0 && agents === 0) return "nobody of its own may open";
  const parts = [
    ...(people > 0 ? [`${people} ${people === 1 ? "person" : "people"}`] : []),
    ...(agents > 0 ? [`${agents} ${agents === 1 ? "agent" : "agents"}`] : []),
  ];
  return `${parts.join(" and ")} of its own may open`;
}
