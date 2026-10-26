import type { ConnectionView } from "api-server-api";

import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Callout } from "@/components/ui/callout";

import { useUpdateGitHubAppScope } from "../api/mutations.js";
import { GithubAccessChoice } from "../forms/github-access-choice.js";
import { GithubAppScopeDraftFields } from "../forms/github-app-scope-draft-fields.js";
import { useGithubAppScopeDraft } from "../hooks/use-github-app-scope-draft.js";
import { fullAccessReach } from "../lib/github-access.js";
import { mutationMessage } from "../lib/mutation-message.js";

export function ConnectionEditGithubAppScopeDialog({
  connection,
  onClose,
}: {
  connection: ConnectionView;
  onClose: () => void;
}) {
  const save = useUpdateGitHubAppScope();
  const draft = useGithubAppScopeDraft(connection.id, {
    scope: connection.githubAppScope,
    fullAccess: connection.fullAccess,
  });

  const saveError = mutationMessage(
    save.error,
    "Couldn't update the scope. Please try again.",
  );

  const submit = async () => {
    if (!draft.choice) return;
    try {
      await save.mutateAsync({ id: connection.id, ...draft.choice });
      onClose();
    } catch {}
  };

  return (
    <Modal onClose={save.isPending ? undefined : onClose}>
      <DialogHeader
        title="Edit repositories & permissions"
        subtitle={connection.name}
        onClose={onClose}
        closeTestId="edit-scope-close"
      />
      <DialogBody className="flex flex-col gap-4">
        <GithubAccessChoice
          value={draft.access}
          onChange={draft.setAccess}
          narrowedLabel="Choose repositories and permissions"
          fullAccessReach={fullAccessReach(connection)}
          testIdPrefix="edit-scope"
        >
          <GithubAppScopeDraftFields draft={draft} purpose="edit" />
        </GithubAccessChoice>
        {saveError && (
          <Callout tone="danger" size="sm">
            {saveError}
          </Callout>
        )}
      </DialogBody>
      <DialogActions
        onCancel={onClose}
        cancelDisabled={save.isPending}
        label="Save"
        pendingLabel="Saving…"
        pending={save.isPending}
        disabled={draft.choice === null}
        onSubmit={() => void submit()}
        testId="edit-scope-submit"
      />
    </Modal>
  );
}
