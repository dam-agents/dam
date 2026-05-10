import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import { useStore } from "../../../store.js";
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
import { GoogleIcon, OpenAIIcon } from "../components/brand-icons.js";
import { ComingSoonCard } from "../components/coming-soon-card.js";

export function ProvidersView() {
  const { data: agents = [] } = useAgents();
  const showConfirm = useStore((s) => s.showConfirm);
  const setView = useStore((s) => s.setView);

  const {
    data: secrets = [],
    isPending: isPendingSecrets,
  } = useSecrets();
  const createSecret = useCreateSecret();
  const updateSecret = useUpdateSecret();
  const deleteSecret = useDeleteSecret();

  const anthropic = secrets.find((s) => s.type === "anthropic");

  return (
    <div className="w-full max-w-2xl">
      <div className="flex items-center gap-3 mb-8">
        <h1 className="text-[20px] md:text-[24px] font-bold text-foreground">Providers</h1>
      </div>

      <p className="text-[14px] text-foreground/80 mb-8 leading-relaxed">
        API keys for the AI harnesses that power your agents.
      </p>

      <section id="tour-anthropic-card" className="mb-8">
        {isPendingSecrets ? (
          <Card className="h-[72px] anim-pulse" />
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
      </section>

      <section>
        <h2 className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.05em] mb-4">
          Coming Soon
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <ComingSoonCard
            name="OpenAI"
            description="Powers Codex agents"
            icon={<OpenAIIcon className="w-5 h-5 text-foreground" />}
          />
          <ComingSoonCard
            name="Google"
            description="Powers Gemini CLI agents"
            icon={<GoogleIcon className="w-5 h-5" />}
          />
        </div>
      </section>
    </div>
  );
}
