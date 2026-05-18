import { useState } from "react";

import {
  type IbmLitellmModelPins,
  ibmLitellmPinsFromEnvMappings,
  PROVIDERS,
  type SecretView,
} from "../../../../types.js";
import { ProviderConnectedShell } from "../shared/provider-connected-shell.js";
import { IbmLitellmForm } from "./form.js";

export function IbmLitellmConnected({
  secret,
  onRemove,
  onSave,
}: {
  secret: SecretView;
  onRemove: () => Promise<void>;
  onSave: (input: {
    value: string;
    pins: IbmLitellmModelPins;
  }) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const currentPins = ibmLitellmPinsFromEnvMappings(secret.envMappings);

  if (editing) {
    return (
      <IbmLitellmForm
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
      title={PROVIDERS["ibm-litellm"].displayName}
      subtitle={
        <>
          Default: <span className="font-mono">{currentPins.default}</span>
        </>
      }
      onEdit={() => setEditing(true)}
      onRemove={onRemove}
    />
  );
}
