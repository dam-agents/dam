import { ArrowRight, Sparkles } from "lucide-react";
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

const SETUP_STEPS: { title: string; description: string }[] = [
  {
    title: "Set up a provider",
    description: "Connect Anthropic so your agents can reach Claude.",
  },
  {
    title: "Create your first agent",
    description: "Pick a template, name it, and you're running.",
  },
  {
    title: "Add connections (optional)",
    description: "Give agents access to GitHub, Google Workspace, and more.",
  },
];

/**
 * One-time welcome dialog. Short and setup-focused: tagline, a preview of
 * the three steps, a single CTA that routes to the providers page (where
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="h-12 w-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-2">
            <Sparkles className="h-6 w-6 text-primary" />
          </div>
          <DialogTitle className="text-2xl">Welcome to DAM</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            Run agent harnesses in the cloud — without exposing your tokens.
          </DialogDescription>
        </DialogHeader>

        <div className="py-1">
          <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-3">
            You'll do 3 things
          </div>
          <ol className="space-y-3">
            {SETUP_STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-3">
                <span className="h-6 w-6 shrink-0 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[11px] font-bold">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{s.title}</div>
                  <div className="text-xs text-muted-foreground">{s.description}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <DialogFooter>
          <Button onClick={handleGetStarted} size="lg" className="w-full">
            Get started <ArrowRight />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
