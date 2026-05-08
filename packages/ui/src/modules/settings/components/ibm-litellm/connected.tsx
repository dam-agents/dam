import { Pencil, X } from "lucide-react";
import { useState } from "react";

import {
  type IbmLitellmModelPins,
  ibmLitellmPinsFromEnvMappings,
  type SecretView,
} from "../../../../types.js";
import { CardIcon } from "../shared/card-icon.js";
import { IconButton } from "../shared/icon-button.js";
import { IbmLitellmForm } from "./form.js";

export function IbmLitellmConnected({
  secret,
  onRemove,
  onSave,
}: {
  secret: SecretView;
  onRemove: () => Promise<void>;
  onSave: (input: { value: string; pins: IbmLitellmModelPins }) => Promise<void>;
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
    <div className="rounded-xl border-2 border-accent bg-accent-light p-5 anim-in shadow-brutal-accent">
      <div className="flex items-center gap-4">
        <CardIcon variant="accent" />
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-bold text-text mb-0.5">IBM LiteLLM ETE Proxy</div>
          <div className="text-[12px] text-text-muted truncate">
            Default: <span className="font-mono">{currentPins.default}</span>
          </div>
        </div>
        <IconButton onClick={() => setEditing(true)} title="Edit" hoverTone="accent">
          <Pencil size={13} />
        </IconButton>
        <IconButton onClick={onRemove} title="Remove" hoverTone="danger">
          <X size={13} />
        </IconButton>
      </div>
    </div>
  );
}
