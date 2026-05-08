import { useStore } from "../../../../store.js";
import { ibmLitellmEnvMappings, PROVIDERS, type SecretView } from "../../../../types.js";
import { useAgents } from "../../../agents/api/queries.js";
import {
  useCreateSecret,
  useDeleteSecret,
  useUpdateSecret,
} from "../../../secrets/api/mutations.js";
import { IbmLitellmConnected } from "./connected.js";
import { IbmLitellmForm } from "./form.js";

const NAME = PROVIDERS["ibm-litellm"].displayName;

/**
 * Self-contained card for the IBM LiteLLM preset. Mints the env-var
 * bundle from user-supplied model pins on every save (the form's
 * "Advanced" disclosure may have changed any of them).
 */
export function IbmLitellmCard({ secret }: { secret?: SecretView }) {
  const showConfirm = useStore((s) => s.showConfirm);
  const setView = useStore((s) => s.setView);
  const { data: agents = [] } = useAgents();
  const createSecret = useCreateSecret();
  const updateSecret = useUpdateSecret();
  const deleteSecret = useDeleteSecret();

  if (secret) {
    return (
      <IbmLitellmConnected
        secret={secret}
        onRemove={async () => {
          if (!(await showConfirm(`Remove ${NAME} token?`, "Remove Token"))) return;
          deleteSecret.mutate({ id: secret.id });
        }}
        onSave={async ({ value, pins }) => {
          await updateSecret.mutateAsync({
            id: secret.id,
            value,
            envMappings: ibmLitellmEnvMappings(pins),
          });
        }}
      />
    );
  }

  return (
    <IbmLitellmForm
      variant="wizard"
      onSave={async ({ value, pins }) => {
        const isFirst = agents.length === 0;
        await createSecret.mutateAsync({
          type: "ibm-litellm",
          name: NAME,
          value,
          envMappings: ibmLitellmEnvMappings(pins),
        });
        if (isFirst) setView("list");
      }}
    />
  );
}
