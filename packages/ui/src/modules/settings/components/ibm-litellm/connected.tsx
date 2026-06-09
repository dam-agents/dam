import { useState } from "react";

import { PROVIDERS } from "../../../../types.js";
import { ProviderConnectedShell } from "../shared/provider-connected-shell.js";
import { IbmLitellmForm } from "./form.js";

export function IbmLitellmConnected({
  onRemove,
  onSave,
}: {
  onRemove: () => Promise<void>;
  onSave: (input: { value: string }) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <IbmLitellmForm
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
      provider="ibm-litellm"
      title={PROVIDERS["ibm-litellm"].displayName}
      subtitle="Routes Claude Code & pi-agent through IBM's LiteLLM proxy"
      onEdit={() => setEditing(true)}
      onRemove={onRemove}
    />
  );
}
