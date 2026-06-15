import {
  bobEnvMappings,
  PROVIDERS,
  type SecretView,
} from "../../../../types.js";
import { useProviderActions } from "../use-provider-actions.js";
import { BobConnected } from "./connected.js";
import { BobForm } from "./form.js";

const NAME = PROVIDERS.bob.displayName;

/** Self-contained card for the Bob Shell preset. The form's Advanced
 *  disclosure may have changed any pin (model, tenant, budget, chat mode),
 *  so we mint a fresh env-var bundle on every save. */
export function BobCard({ secret }: { secret?: SecretView }) {
  const actions = useProviderActions();

  if (secret) {
    return (
      <BobConnected
        secret={secret}
        onRemove={() => actions.remove(secret.id)}
        onSave={({ value, pins }) =>
          actions.update({
            id: secret.id,
            value,
            envMappings: bobEnvMappings(pins),
          })
        }
      />
    );
  }

  return (
    <BobForm
      variant="wizard"
      onSave={({ value, pins }) =>
        actions.create({
          type: "bob",
          name: NAME,
          value,
          envMappings: bobEnvMappings(pins),
        })
      }
    />
  );
}
