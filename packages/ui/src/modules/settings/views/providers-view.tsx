import { RefreshCw } from "lucide-react";

import { useStore } from "../../../store.js";
import { ibmLitellmEnvMappings } from "../../../types.js";
import { useAgents } from "../../agents/api/queries.js";
import {
  useCreateSecret,
  useDeleteSecret,
  useUpdateSecret,
} from "../../secrets/api/mutations.js";
import { useSecrets } from "../../secrets/api/queries.js";
import { AnthropicConnected } from "../components/anthropic/connected.js";
import { AnthropicForm } from "../components/anthropic/form.js";
import { MODES } from "../components/anthropic/modes.js";
import { ComingSoonCard } from "../components/coming-soon-card.js";
import { IbmLitellmConnected } from "../components/ibm-litellm/connected.js";
import { IbmLitellmForm } from "../components/ibm-litellm/form.js";

export function ProvidersView() {
  const { data: agents = [] } = useAgents();
  const showConfirm = useStore((s) => s.showConfirm);
  const setView = useStore((s) => s.setView);

  const {
    data: secrets = [],
    refetch: refetchSecrets,
    isFetching: isFetchingSecrets,
    isPending: isPendingSecrets,
  } = useSecrets();
  const createSecret = useCreateSecret();
  const updateSecret = useUpdateSecret();
  const deleteSecret = useDeleteSecret();

  const anthropic = secrets.find((s) => s.type === "anthropic");
  const ibmLitellm = secrets.find((s) => s.type === "ibm-litellm");

  return (
    <div className="w-full max-w-2xl">
      <div className="flex items-center gap-3 mb-8">
        <h1 className="text-[20px] md:text-[24px] font-bold text-text">Providers</h1>
        <button
          onClick={() => refetchSecrets()}
          className="ml-auto h-8 w-8 rounded-lg border-2 border-border bg-surface flex items-center justify-center text-text-secondary hover:text-accent hover:border-accent btn-brutal shadow-brutal-sm"
        >
          <span className={isFetchingSecrets ? "anim-spin" : ""}>
            <RefreshCw size={13} />
          </span>
        </button>
      </div>

      <p className="text-[14px] text-text-secondary mb-8 leading-relaxed">
        API keys for the AI harnesses that power your agents.
      </p>

      <section className="mb-8 flex flex-col gap-4">
        {isPendingSecrets ? (
          <div className="rounded-xl border-2 border-border-light bg-surface px-5 py-4 h-[72px] anim-pulse" />
        ) : anthropic ? (
          <AnthropicConnected
            secret={anthropic}
            onRemove={async () => {
              if (!(await showConfirm("Remove Anthropic API key?", "Remove Key"))) return;
              deleteSecret.mutate({ id: anthropic.id });
            }}
            onSave={async ({ mode, value }) => {
              await updateSecret.mutateAsync({
                id: anthropic.id,
                value,
                envMappings: [MODES[mode].mapping],
              });
            }}
          />
        ) : (
          <AnthropicForm
            variant="wizard"
            initialMode="oauth"
            onSave={async ({ mode, value }) => {
              const isFirst = agents.length === 0;
              await createSecret.mutateAsync({
                type: "anthropic",
                name: "Anthropic API Key",
                value,
                envMappings: [MODES[mode].mapping],
              });
              if (isFirst) setView("list");
            }}
          />
        )}

        {isPendingSecrets ? null : ibmLitellm ? (
          <IbmLitellmConnected
            secret={ibmLitellm}
            onRemove={async () => {
              if (!(await showConfirm("Remove IBM LiteLLM ETE Proxy token?", "Remove Token"))) return;
              deleteSecret.mutate({ id: ibmLitellm.id });
            }}
            onSave={async ({ value, pins }) => {
              await updateSecret.mutateAsync({
                id: ibmLitellm.id,
                value,
                envMappings: ibmLitellmEnvMappings(pins),
              });
            }}
          />
        ) : (
          <IbmLitellmForm
            variant="wizard"
            onSave={async ({ value, pins }) => {
              const isFirst = agents.length === 0;
              await createSecret.mutateAsync({
                type: "ibm-litellm",
                name: "IBM LiteLLM ETE Proxy",
                value,
                envMappings: ibmLitellmEnvMappings(pins),
              });
              if (isFirst) setView("list");
            }}
          />
        )}
      </section>

      <section>
        <h2 className="text-[11px] font-bold text-text-muted uppercase tracking-[0.05em] mb-4">
          Coming Soon
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <ComingSoonCard name="OpenAI" description="Powers Codex agents" />
          <ComingSoonCard name="Google" description="Powers Gemini CLI agents" />
        </div>
      </section>
    </div>
  );
}
