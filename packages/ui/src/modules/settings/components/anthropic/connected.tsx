import { useState } from "react";

import { PROVIDERS, type SecretView } from "../../../../types.js";
import { ProviderConnectedShell } from "../shared/provider-connected-shell.js";
import { AnthropicForm } from "./form.js";
import { detectMode, type Mode, MODES } from "./modes.js";

export function AnthropicConnected({
  secret,
  onRemove,
  onSave,
}: {
  secret: SecretView;
  onRemove: () => Promise<void>;
  onSave: (input: { mode: Mode; value: string }) => Promise<void>;
}) {
  const currentMode = detectMode(secret.envMappings?.[0]?.envName);
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <AnthropicForm
        variant="edit"
        initialMode={currentMode}
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
      provider="anthropic"
      title={PROVIDERS.anthropic.displayName}
      subtitle={`Set up with ${MODES[currentMode].label}`}
      onEdit={() => setEditing(true)}
      onRemove={onRemove}
    />
  );
}
