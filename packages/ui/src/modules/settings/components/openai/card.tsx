import { useStore } from "../../../../store.js";
import { PROVIDERS, type SecretView } from "../../../../types.js";
import { useAgents } from "../../../agents/api/queries.js";
import {
  useCreateSecret,
  useDeleteSecret,
  useUpdateSecret,
} from "../../../secrets/api/mutations.js";
import { OpenAIConnected } from "./connected.js";
import { OpenAIForm } from "./form.js";

const NAME = PROVIDERS.openai.displayName;

/**
 * Self-contained card for the OpenAI preset. Single-token form;
 * the registry's `pathPattern: "/v1/*"` is applied server-side at
 * create time.
 */
export function OpenAICard({ secret }: { secret?: SecretView }) {
  const showConfirm = useStore((s) => s.showConfirm);
  const setView = useStore((s) => s.setView);
  const { data: agents = [] } = useAgents();
  const createSecret = useCreateSecret();
  const updateSecret = useUpdateSecret();
  const deleteSecret = useDeleteSecret();

  if (secret) {
    return (
      <OpenAIConnected
        secret={secret}
        onRemove={async () => {
          if (!(await showConfirm(`Remove ${NAME} API key?`, "Remove Key"))) return;
          deleteSecret.mutate({ id: secret.id });
        }}
        onSave={async ({ value }) => {
          await updateSecret.mutateAsync({ id: secret.id, value });
        }}
      />
    );
  }

  return (
    <OpenAIForm
      variant="wizard"
      onSave={async ({ value }) => {
        const isFirst = agents.length === 0;
        await createSecret.mutateAsync({ type: "openai", name: NAME, value });
        if (isFirst) setView("list");
      }}
    />
  );
}
