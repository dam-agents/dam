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
import { sharedThroughAgent } from "../lib/environment-list.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The owner's Share dialog for one Environment. It
 * says who opens it through its agent — the owner, the agent's editors and how
 * many people the agent's page names — and links there, and edits the
 * Environment's own members, who open this one Environment only. The list only
 * adds people: nobody here narrows the agent's. An Environment is never
 * public, so there is no link to copy beyond its addresses. It holds only
 * the owner's edits over the members the list polls, so a member added
 * elsewhere while it is open shows up, and a Save never drops them unseen.
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
  const [edited, setEdited] = useState<string[] | null>(null);
  const [draft, setDraft] = useState("");
  const members = edited ?? environment.members;
  const dirty = edited !== null && !sameViewers(edited, environment.members);
  const pendingDraft = draft.trim().length > 0;
  const agentName = agent?.name ?? "its agent";

  const onSave = () =>
    save.mutate(
      { id: environment.id, emails: members },
      {
        onSuccess: (saved) => {
          setEdited(null);
          emitToast({
            kind: "success",
            message: `Sharing updated — ${saved.members.length === 0 ? "nobody of its own may open" : `${saved.members.length} of its own may open`} ${environment.name}.`,
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
              onChange={setEdited}
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
          {pendingDraft && (
            <p role="status" className="text-xs text-muted-foreground">
              Add the email address to the list or clear it before saving.
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
