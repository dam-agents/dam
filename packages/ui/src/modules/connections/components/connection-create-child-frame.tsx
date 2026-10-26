import type { ConnectionView } from "api-server-api";
import { type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";

import { useCreateConnectionFromParent } from "../api/mutations.js";
import { useAppConnections } from "../api/queries.js";
import { GithubAccessChoice } from "../forms/github-access-choice.js";
import { LabeledInput } from "../forms/labeled-input.js";
import {
  childNameError,
  defaultChildName,
} from "../lib/connection-hierarchy.js";
import {
  type FullAccessChoice,
  fullAccessReach,
  type GithubAccess,
} from "../lib/github-access.js";
import type { AppScopeChoice } from "../lib/github-app-scope-fields.js";
import type { UserTokenScopeChoice } from "../lib/github-user-token-scope.js";
import { mutationMessage } from "../lib/mutation-message.js";

const NO_CONNECTIONS: ConnectionView[] = [];

export interface CreateChildFormProps {
  parent: ConnectionView;
  onCreated: (id: string) => void;
  onCancel: () => void;
  layout: (fields: ReactNode, footer: ReactNode) => ReactNode;
}

interface Props extends CreateChildFormProps {
  access: GithubAccess;
  onAccessChange: (access: GithubAccess) => void;
  choice: FullAccessChoice | UserTokenScopeChoice | AppScopeChoice | null;
  narrowedLabel: string;
  children: ReactNode;
}

export function ConnectionCreateChildFrame({
  parent,
  onCreated,
  onCancel,
  layout,
  access,
  onAccessChange,
  choice,
  narrowedLabel,
  children,
}: Props) {
  const connections = useAppConnections().data ?? NO_CONNECTIONS;
  const create = useCreateConnectionFromParent();
  const [editedName, setEditedName] = useState<string | null>(null);
  const name = (editedName ?? defaultChildName(parent, connections)).trim();
  const nameError = childNameError(name, connections);
  const saveError = mutationMessage(
    create.error,
    "Couldn't create the connection. Please try again.",
  );

  const submit = async () => {
    if (!choice || nameError) return;
    try {
      const { id } = await create.mutateAsync({
        parentId: parent.id,
        name,
        ...choice,
      });
      onCreated(id);
    } catch {}
  };

  const fields = (
    <div className="flex flex-col gap-4">
      <LabeledInput
        label="Name"
        testId="create-child-name"
        value={editedName ?? name}
        onChange={setEditedName}
        error={editedName === null ? undefined : (nameError ?? undefined)}
      />
      <GithubAccessChoice
        value={access}
        onChange={onAccessChange}
        narrowedLabel={narrowedLabel}
        fullAccessReach={fullAccessReach(parent)}
        testIdPrefix="create-child"
      >
        {children}
      </GithubAccessChoice>
      {saveError && (
        <Callout tone="danger" size="sm">
          {saveError}
        </Callout>
      )}
    </div>
  );

  const footer = (
    <>
      <Button variant="outline" onClick={onCancel} disabled={create.isPending}>
        Cancel
      </Button>
      <Button
        onClick={() => void submit()}
        disabled={!choice || nameError !== null || create.isPending}
        data-testid="create-child-submit"
      >
        {create.isPending ? "Creating…" : "Create connection"}
      </Button>
    </>
  );

  return <>{layout(fields, footer)}</>;
}
