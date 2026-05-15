import { ibmLitellmEnvMappings, PROVIDERS, type SecretView } from "../../../../types.js";
import { useProviderActions } from "../use-provider-actions.js";
import { IbmLitellmConnected } from "./connected.js";
import { IbmLitellmForm } from "./form.js";

const NAME = PROVIDERS["ibm-litellm"].displayName;

/** Self-contained card for the IBM LiteLLM preset. The form's "Advanced"
 *  disclosure may have changed any model pin, so we mint a fresh
 *  env-var bundle on every save. */
export function IbmLitellmCard({ secret }: { secret?: SecretView }) {
  const actions = useProviderActions();

  if (secret) {
    return (
      <IbmLitellmConnected
        secret={secret}
        onRemove={() => actions.remove(secret.id, `Remove ${NAME} token?`, "Remove Token")}
        onSave={({ value, pins }) =>
          actions.update({
            id: secret.id,
            value,
            envMappings: ibmLitellmEnvMappings(pins),
          })
        }
      />
    );
  }

  return (
    <IbmLitellmForm
      variant="wizard"
      onSave={({ value, pins }) =>
        actions.create({
          type: "ibm-litellm",
          name: NAME,
          value,
          envMappings: ibmLitellmEnvMappings(pins),
        })
      }
    />
  );
}
