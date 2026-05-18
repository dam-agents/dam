import { useState } from "react";

import {
  type BobModelPins,
  bobPinsFromEnvMappings,
  PROVIDERS,
  type SecretView,
} from "../../../../types.js";
import { ProviderConnectedShell } from "../shared/provider-connected-shell.js";
import { BobForm } from "./form.js";

export function BobConnected({
  secret,
  onRemove,
  onSave,
}: {
  secret: SecretView;
  onRemove: () => Promise<void>;
  onSave: (input: { value: string; pins: BobModelPins }) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const currentPins = bobPinsFromEnvMappings(secret.envMappings);

  if (editing) {
    return (
      <BobForm
        variant="edit"
        initialPins={currentPins}
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
      provider="bob"
      title={PROVIDERS.bob.displayName}
      subtitle={
        currentPins.model ? (
          <>
            Model: <span className="font-mono">{currentPins.model}</span>
          </>
        ) : (
          <>Default model</>
        )
      }
      onEdit={() => setEditing(true)}
      onRemove={onRemove}
    />
  );
}
