import {
  ibmLitellmEnvMappings,
  PROVIDERS,
  type SecretView,
} from "../../../../types.js";
import { useProviderActions } from "../use-provider-actions.js";
import { IbmLitellmConnected } from "./connected.js";
import { IbmLitellmForm } from "./form.js";

const NAME = PROVIDERS["ibm-litellm"].displayName;

/** Self-contained card for the IBM LiteLLM preset. */
export function IbmLitellmCard({ secret }: { secret?: SecretView }) {
  const actions = useProviderActions();

  if (secret) {
    return (
      <IbmLitellmConnected
        onRemove={() => actions.remove(secret.id, NAME)}
        onSave={({ value }) =>
          actions.update({
            id: secret.id,
            value,
            envMappings: ibmLitellmEnvMappings(),
          })
        }
      />
    );
  }

  return (
    <IbmLitellmForm
      variant="wizard"
      onSave={({ value }) =>
        actions.create({
          type: "ibm-litellm",
          name: NAME,
          value,
          envMappings: ibmLitellmEnvMappings(),
        })
      }
    />
  );
}
