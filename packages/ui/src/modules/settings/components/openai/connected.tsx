import { useState } from "react";

import { PROVIDERS, type SecretView } from "../../../../types.js";
import { ProviderConnectedShell } from "../shared/provider-connected-shell.js";
import { OpenAIForm } from "./form.js";

export function OpenAIConnected({
  onRemove,
  onSave,
}: {
  /** Currently unused — the connected card has no per-secret state to
   *  display beyond "API key configured." Kept on the prop type for
   *  symmetry with the other preset cards. */
  secret: SecretView;
  onRemove: () => Promise<void>;
  onSave: (input: { value: string }) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <OpenAIForm
        variant="edit"
        onCancel={() => setEditing(false)}
        onSave={async (input) => {
          await onSave(input);
          setEditing(false);
        }}
      />
    );
  }

  return (
    <ProviderConnectedShell
      title={PROVIDERS.openai.displayName}
      subtitle="API key configured."
      onEdit={() => setEditing(true)}
      onRemove={onRemove}
    />
  );
}
