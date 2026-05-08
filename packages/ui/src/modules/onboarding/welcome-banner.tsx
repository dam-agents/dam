import { ArrowRight, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";

import { useAgents } from "../agents/api/queries.js";
import { useSecrets } from "../secrets/api/queries.js";
import { useStore } from "../../store.js";

/**
 * Persistent top banner shown until the user has both a provider configured
 * and at least one agent created. Clicking "Continue setup" opens the
 * welcome wizard (even after initial dismissal).
 */
export function WelcomeBanner() {
  const { data: agents = [], isSuccess: agentsLoaded } = useAgents();
  const { data: secrets = [], isSuccess: secretsLoaded } = useSecrets();
  const openWelcomeWizard = useStore((s) => s.openWelcomeWizard);

  const ready = agentsLoaded && secretsLoaded;
  const hasProvider = secrets.some((s) => s.type === "anthropic");
  const hasAgent = agents.length > 0;
  const incomplete = !hasProvider || !hasAgent;

  if (!ready || !incomplete) return null;

  const message =
    !hasProvider && !hasAgent
      ? "Set up a provider and create your first agent."
      : !hasProvider
        ? "Set up a provider so your agents can reach an AI model."
        : "Create your first agent.";

  return (
    <div className="safe-top w-full bg-primary text-primary-foreground shrink-0">
      <div className="w-full px-4 md:px-6 py-2.5 flex items-center gap-3">
        <div className="h-8 w-8 rounded-md bg-white/10 border border-white/20 flex items-center justify-center shrink-0">
          <Sparkles className="h-4 w-4 text-primary-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate">Finish setting up DAM</div>
          <div className="text-xs text-primary-foreground/80 truncate">{message}</div>
        </div>
        <Button
          size="sm"
          onClick={() => openWelcomeWizard()}
          className="bg-white text-primary hover:bg-white/90"
        >
          Continue setup <ArrowRight />
        </Button>
      </div>
    </div>
  );
}
