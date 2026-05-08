import { ArrowRight, CalendarClock, Cloud, ShieldCheck, Sparkles, Users } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { useAgents } from "../agents/api/queries.js";
import { useStore } from "../../store.js";

const DISMISS_KEY = "platform-welcome-modal-dismissed";
// In mock mode, a designer reviewing the UI should see the modal on every
// reload. Skip persistence so dismissal only survives the current session.
const PERSIST_DISMISS = import.meta.env.VITE_USE_MOCKS !== "true";

/**
 * One-time welcome dialog shown to a fresh user before they've created any
 * agents. Dismissing kicks off the flow by navigating to the providers view,
 * where the stepper banner takes over.
 */
export function WelcomeModal() {
  const { data: agents = [], isSuccess } = useAgents();
  const setView = useStore((s) => s.setView);
  const [dismissed, setDismissed] = useState(
    () => PERSIST_DISMISS && localStorage.getItem(DISMISS_KEY) === "true",
  );

  const shouldShow = isSuccess && agents.length === 0 && !dismissed;

  const dismiss = () => {
    if (PERSIST_DISMISS) localStorage.setItem(DISMISS_KEY, "true");
    setDismissed(true);
  };

  const handleGetStarted = () => {
    dismiss();
    setView("providers");
  };

  return (
    <Dialog open={shouldShow} onOpenChange={(open) => !open && dismiss()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="h-12 w-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-2">
            <Sparkles className="h-6 w-6 text-primary" />
          </div>
          <DialogTitle className="text-2xl">Welcome to DAM</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            Run agent harnesses like Claude Code headless in the cloud, on a
            schedule, connected to your tools — without exposing your tokens.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-3">
            Why DAM?
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <FeatureCard
              icon={<Cloud className="h-4 w-4" />}
              title="Sessions that don't die"
              description="Your agent runs in the cloud — close your laptop, go home, come back tomorrow. It's still there."
            />
            <FeatureCard
              icon={<ShieldCheck className="h-4 w-4" />}
              title="Credentials stay safe"
              description="Tokens are injected on the wire by a separate gateway. The agent never sees them — even if compromised."
            />
            <FeatureCard
              icon={<Users className="h-4 w-4" />}
              title="Team collaboration"
              description="Colleagues interact via Slack using their own credentials. No token sharing, no security trade-offs."
            />
            <FeatureCard
              icon={<CalendarClock className="h-4 w-4" />}
              title="Scheduled execution"
              description={`“Review all new PRs every morning at 9am.” Set it and forget it.`}
            />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleGetStarted} size="lg" className="w-full sm:w-auto">
            Get started <ArrowRight />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="h-7 w-7 rounded-md bg-primary/10 text-primary flex items-center justify-center mb-2">
        {icon}
      </div>
      <div className="text-sm font-semibold mb-0.5">{title}</div>
      <div className="text-xs text-muted-foreground leading-snug">{description}</div>
    </div>
  );
}
