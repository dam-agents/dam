import { PROVIDERS, type SecretView } from "../../../../types.js";
import { useProviderActions } from "../use-provider-actions.js";
import { AnthropicConnected } from "./connected.js";
import { AnthropicForm } from "./form.js";
import { MODES } from "./modes.js";

const NAME = PROVIDERS.anthropic.displayName;

/** Self-contained card for the Anthropic preset. */
export function AnthropicCard({ secret }: { secret?: SecretView }) {
  const actions = useProviderActions();

  if (secret) {
    return (
      <AnthropicConnected
        secret={secret}
        onRemove={() => actions.remove(secret.id)}
        onSave={({ mode, value }) =>
          actions.update({
            id: secret.id,
            value,
            envMappings: [MODES[mode].mapping],
          })
        }
      />
    );
  }

  return (
    <AnthropicForm
      variant="wizard"
      initialMode="oauth"
      onSave={({ mode, value }) =>
        actions.create({
          type: "anthropic",
          name: NAME,
          value,
          envMappings: [MODES[mode].mapping],
        })
      }
    />
  );
}
