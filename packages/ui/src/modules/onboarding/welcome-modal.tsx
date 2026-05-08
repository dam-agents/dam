import { ArrowRight, CalendarClock, Cloud, ShieldCheck, Users } from "lucide-react";
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

const FEATURES: { icon: React.ComponentType<{ className?: string }>; title: string; description: string }[] = [
  {
    icon: Cloud,
    title: "Sessions that don't die",
    description:
      "Your agent runs in the cloud — close your laptop, go home, come back tomorrow. It's still there.",
  },
  {
    icon: ShieldCheck,
    title: "Credentials stay safe",
    description:
      "Tokens are injected on the wire by a separate gateway. The agent never sees them — even if compromised.",
  },
  {
    icon: Users,
    title: "Team collaboration",
    description:
      "Colleagues interact via Slack using their own credentials. No token sharing, no security trade-offs.",
  },
  {
    icon: CalendarClock,
    title: "Scheduled execution",
    description: "“Review all new PRs every morning at 9am.” Set it and forget it.",
  },
];

/**
 * One-time welcome dialog. Product intro with the "Why DAM?" pitch — tagline,
 * four feature cards, and a CTA that routes to the providers page (where
 * step 1 happens and the stepper banner takes over).
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
          <DialogTitle>Welcome to DAM</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed pt-1">
            Run agent harnesses like Claude Code headless in the cloud, on a
            schedule, connected to your tools — without exposing your tokens.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-3">
            Why DAM?
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-lg border bg-card p-3">
                <div className="h-7 w-7 rounded-md bg-primary/10 text-primary flex items-center justify-center mb-2">
                  <f.icon className="h-4 w-4" />
                </div>
                <div className="text-sm font-semibold mb-0.5">{f.title}</div>
                <div className="text-xs text-muted-foreground leading-snug">{f.description}</div>
              </div>
            ))}
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
