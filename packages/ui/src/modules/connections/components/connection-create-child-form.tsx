import { match } from "ts-pattern";

import { GithubAppScopeDraftFields } from "../forms/github-app-scope-draft-fields.js";
import { GithubUserTokenScopeFields } from "../forms/github-user-token-scope-fields.js";
import { useGithubAppScopeDraft } from "../hooks/use-github-app-scope-draft.js";
import { useGithubUserTokenScopeDraft } from "../hooks/use-github-user-token-scope-draft.js";
import { githubCredentialKind } from "../lib/github-access.js";
import {
  ConnectionCreateChildFrame,
  type CreateChildFormProps,
} from "./connection-create-child-frame.js";

const NOTHING_HELD = {};

// UNIT_BOUNDARY_DESCRIPTION: the step that makes a connection from a GitHub sign-in or a GitHub App installation, which no agent can hold itself. It reads what the sign-in or installation can reach with its own credential and creates the connection once a reach is chosen; the caller lays the fields and the buttons out as a dialog or a catalog pane.
export function ConnectionCreateChildForm(props: CreateChildFormProps) {
  return match(githubCredentialKind(props.parent))
    .with("installation", () => <InstallationChildForm {...props} />)
    .with("sign-in", () => <SignInChildForm {...props} />)
    .exhaustive();
}

function SignInChildForm(props: CreateChildFormProps) {
  const draft = useGithubUserTokenScopeDraft(props.parent.id, NOTHING_HELD);
  return (
    <ConnectionCreateChildFrame
      {...props}
      access={draft.access}
      onAccessChange={draft.setAccess}
      choice={draft.choice}
      narrowedLabel="Choose account, repositories and permissions"
    >
      <GithubUserTokenScopeFields draft={draft} />
    </ConnectionCreateChildFrame>
  );
}

function InstallationChildForm(props: CreateChildFormProps) {
  const draft = useGithubAppScopeDraft(props.parent.id, NOTHING_HELD);
  return (
    <ConnectionCreateChildFrame
      {...props}
      access={draft.access}
      onAccessChange={draft.setAccess}
      choice={draft.choice}
      narrowedLabel="Choose repositories and permissions"
    >
      <GithubAppScopeDraftFields draft={draft} purpose="new" />
    </ConnectionCreateChildFrame>
  );
}
