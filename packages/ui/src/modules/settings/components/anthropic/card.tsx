import { useStore } from "../../../../store.js";
import { PROVIDERS, type SecretView } from "../../../../types.js";
import { useAgents } from "../../../agents/api/queries.js";
import {
  useCreateSecret,
  useDeleteSecret,
  useUpdateSecret,
} from "../../../secrets/api/mutations.js";
import { AnthropicConnected } from "./connected.js";
import { AnthropicForm } from "./form.js";
import { MODES } from "./modes.js";

/**
 * Self-contained card for the Anthropic preset. Renders the connected
 * card when a secret exists, the wizard form otherwise. Owns its
 * mutation hooks so `providers-view.tsx` only places the card in layout.
 */
export function AnthropicCard({ secret }: { secret?: SecretView }) {
  const showConfirm = useStore((s) => s.showConfirm);
  const setView = useStore((s) => s.setView);
  const { data: agents = [] } = useAgents();
  const createSecret = useCreateSecret();
  const updateSecret = useUpdateSecret();
  const deleteSecret = useDeleteSecret();

  if (secret) {
    return (
      <AnthropicConnected
        secret={secret}
        onRemove={async () => {
          if (!(await showConfirm("Remove Anthropic API key?", "Remove Key"))) return;
          deleteSecret.mutate({ id: secret.id });
        }}
        onSave={async ({ mode, value }) => {
          await updateSecret.mutateAsync({
            id: secret.id,
            value,
            envMappings: [MODES[mode].mapping],
          });
        }}
      />
    );
  }

  return (
    <AnthropicForm
      variant="wizard"
      initialMode="oauth"
      onSave={async ({ mode, value }) => {
        const isFirst = agents.length === 0;
        await createSecret.mutateAsync({
          type: "anthropic",
          name: PROVIDERS.anthropic.displayName,
          value,
          envMappings: [MODES[mode].mapping],
        });
        if (isFirst) setView("list");
      }}
    />
  );
}
