import { PROVIDERS, type SecretView } from "../../../../types.js";
import { useProviderActions } from "../use-provider-actions.js";
import { OpenAIConnected } from "./connected.js";
import { OpenAIForm } from "./form.js";

const NAME = PROVIDERS.openai.displayName;

/** Self-contained card for the OpenAI preset. The registry's
 *  `pathPattern: "/v1/*"` is applied server-side at create time. */
export function OpenAICard({ secret }: { secret?: SecretView }) {
  const actions = useProviderActions();

  if (secret) {
    return (
      <OpenAIConnected
        secret={secret}
        onRemove={() => actions.remove(secret.id, NAME)}
        onSave={({ value }) => actions.update({ id: secret.id, value })}
      />
    );
  }

  return (
    <OpenAIForm
      variant="wizard"
      onSave={({ value }) =>
        actions.create({ type: "openai", name: NAME, value })
      }
    />
  );
}
