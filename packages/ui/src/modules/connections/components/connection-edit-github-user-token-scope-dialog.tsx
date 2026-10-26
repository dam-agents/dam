import type { ConnectionView } from "api-server-api";

import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Callout } from "@/components/ui/callout";

import { useUpdateGitHubUserTokenScope } from "../api/mutations.js";
import { GithubAccessChoice } from "../forms/github-access-choice.js";
import { GithubUserTokenScopeFields } from "../forms/github-user-token-scope-fields.js";
import { useGithubUserTokenScopeDraft } from "../hooks/use-github-user-token-scope-draft.js";
import { fullAccessReach } from "../lib/github-access.js";
import { mutationMessage } from "../lib/mutation-message.js";

export function ConnectionEditGithubUserTokenScopeDialog({
  connection,
  onClose,
}: {
  connection: ConnectionView;
  onClose: () => void;
}) {
  const save = useUpdateGitHubUserTokenScope();
  const draft = useGithubUserTokenScopeDraft(connection.id, {
    scope: connection.githubUserToken?.scope,
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
        closeTestId="edit-user-scope-close"
      />
      <DialogBody className="flex flex-col gap-4">
        <GithubAccessChoice
          value={draft.access}
          onChange={draft.setAccess}
          narrowedLabel="Choose account, repositories and permissions"
          fullAccessReach={fullAccessReach(connection)}
          testIdPrefix="edit-user-scope"
        >
          <GithubUserTokenScopeFields draft={draft} />
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
        testId="edit-user-scope-submit"
      />
    </Modal>
  );
}
