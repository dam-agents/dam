import { AlertTriangle, ArrowRight, Check, Plug, Sparkles, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";

import { useStore } from "../../store.js";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

import { useOAuthApps } from "../connections/api/queries.js";
import { useCreateAgent } from "../agents/api/mutations.js";
import { useAgents } from "../agents/api/queries.js";
import { useCreateSecret } from "../secrets/api/mutations.js";
import { useSecrets } from "../secrets/api/queries.js";
import { AnthropicForm } from "../settings/components/anthropic/form.js";
import { MODES } from "../settings/components/anthropic/modes.js";
import { useTemplates } from "../templates/api/queries.js";

type StepKey = "welcome" | "provider" | "agent" | "connections";

const STEPS: { key: StepKey; label: string; icon: typeof Sparkles }[] = [
  { key: "welcome", label: "Welcome", icon: Sparkles },
  { key: "provider", label: "Provider", icon: Sparkles },
  { key: "agent", label: "Agent", icon: UserPlus },
  { key: "connections", label: "Connections", icon: Plug },
];

const DISMISS_KEY = "platform-welcome-wizard-dismissed";
// In mock mode we skip persistence so a designer reviewing can re-open the
// wizard by refreshing.
const PERSIST_DISMISS = import.meta.env.VITE_USE_MOCKS !== "true";

export function WelcomeWizard() {
  const { data: agents = [], isSuccess: agentsLoaded } = useAgents();
  const { data: secrets = [], isSuccess: secretsLoaded } = useSecrets();
  const openRequest = useStore((s) => s.welcomeWizardOpenRequest);
  const [step, setStep] = useState<StepKey>("welcome");
  const [dismissed, setDismissed] = useState(
    () => PERSIST_DISMISS && localStorage.getItem(DISMISS_KEY) === "true",
  );
  const [forceOpen, setForceOpen] = useState(false);

  // When the user hits "Reopen walkthrough" from settings, the store bumps
  // openRequest. Treat that as an explicit request to override dismissal.
  useEffect(() => {
    if (openRequest === 0) return;
    if (PERSIST_DISMISS) localStorage.removeItem(DISMISS_KEY);
    setDismissed(false);
    setForceOpen(true);
    setStep("welcome");
  }, [openRequest]);

  const ready = agentsLoaded && secretsLoaded;
  const shouldShow = (ready && agents.length === 0 && !dismissed) || forceOpen;

  const handleDismiss = () => {
    if (PERSIST_DISMISS) localStorage.setItem(DISMISS_KEY, "true");
    setDismissed(true);
    setForceOpen(false);
  };

  const goNext = () => {
    const idx = STEPS.findIndex((s) => s.key === step);
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1].key);
  };

  const goBack = () => {
    const idx = STEPS.findIndex((s) => s.key === step);
    if (idx > 0) setStep(STEPS[idx - 1].key);
  };

  const stepIndex = STEPS.findIndex((s) => s.key === step);
  const hasProvider = secrets.some((s) => s.type === "anthropic");

  return (
    <Dialog open={shouldShow} onOpenChange={(open) => !open && handleDismiss()}>
      <DialogContent
        className="max-w-2xl p-0 gap-0 max-h-[85vh] overflow-hidden flex flex-col"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <StepHeader currentStep={stepIndex} hasProvider={hasProvider} />
        <div className="flex-1 overflow-y-auto p-8">
          {step === "welcome" && <WelcomeStep onNext={goNext} />}
          {step === "provider" && (
            <ProviderStep
              onBack={goBack}
              onNext={goNext}
              alreadyConfigured={hasProvider}
            />
          )}
          {step === "agent" && <AgentStep onBack={goBack} onNext={goNext} />}
          {step === "connections" && <ConnectionsStep onBack={goBack} onDone={handleDismiss} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StepHeader({ currentStep, hasProvider }: { currentStep: number; hasProvider: boolean }) {
  return (
    <div className="px-8 pt-6 pb-4 border-b bg-muted/40">
      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => {
          const done = i < currentStep || (s.key === "provider" && hasProvider && i <= currentStep);
          const active = i === currentStep;
          return (
            <div key={s.key} className="flex items-center gap-2 flex-1">
              <div
                className={cn(
                  "h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 transition-colors",
                  active && "bg-primary text-primary-foreground",
                  done && !active && "bg-success text-white",
                  !active && !done && "bg-muted text-muted-foreground",
                )}
              >
                {done && !active ? <Check className="h-4 w-4" /> : i === 0 ? "👋" : i}
              </div>
              <span
                className={cn(
                  "text-xs font-semibold hidden sm:inline truncate",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {s.label}
                {s.key === "connections" && <span className="text-muted-foreground font-normal"> (optional)</span>}
              </span>
              {i < STEPS.length - 1 && <div className="flex-1 h-px bg-border" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col items-center text-center gap-6 py-4">
      <div className="h-16 w-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
        <Sparkles className="h-8 w-8 text-primary" />
      </div>
      <div className="space-y-3 max-w-md">
        <h1 className="text-2xl font-bold">Welcome to DAM</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          DAM runs AI agent harnesses — like Claude Code, Codex, and Gemini CLI — in
          isolated environments with secure credential injection, network
          controls, and scheduled execution.
        </p>
        <p className="text-xs text-muted-foreground italic">
          (Placeholder copy — replace with your own.)
        </p>
      </div>
      <div className="w-full max-w-xs pt-2">
        <Button size="lg" className="w-full" onClick={onNext}>
          Get started <ArrowRight />
        </Button>
      </div>
    </div>
  );
}

function ProviderStep({
  onBack,
  onNext,
  alreadyConfigured,
}: {
  onBack: () => void;
  onNext: () => void;
  alreadyConfigured: boolean;
}) {
  const createSecret = useCreateSecret();

  if (alreadyConfigured) {
    return (
      <StepShell
        title="Provider connected"
        subtitle="Anthropic is already set up. You're ready for the next step."
        onBack={onBack}
        primary={{ label: "Next step", onClick: onNext, icon: <ArrowRight /> }}
      >
        <div className="flex items-center gap-3 rounded-lg border bg-card p-4">
          <div className="h-10 w-10 rounded-lg bg-success/10 border border-success/20 flex items-center justify-center">
            <Check className="h-5 w-5 text-success" />
          </div>
          <div>
            <div className="text-sm font-semibold">Anthropic ✓</div>
            <div className="text-xs text-muted-foreground">Claude models are available to your agents.</div>
          </div>
        </div>
      </StepShell>
    );
  }

  return (
    <StepShell
      title="Set up a provider"
      subtitle="Agents need at least one provider to reach an AI model. Start with Anthropic."
      onBack={onBack}
      primary={{ label: "Next step", onClick: onNext, icon: <ArrowRight /> }}
    >
      <AnthropicForm
        variant="wizard"
        initialMode="api-key"
        embedded
        onSave={async ({ mode, value }) => {
          await createSecret.mutateAsync({
            type: "anthropic",
            name: "Anthropic API Key",
            value,
            envMappings: [MODES[mode].mapping],
          });
          onNext();
        }}
      />
    </StepShell>
  );
}

function AgentStep({
  onBack,
  onNext,
}: {
  onBack: () => void;
  onNext: () => void;
}) {
  const { data: templates = [] } = useTemplates();
  const { data: secrets = [] } = useSecrets();
  const [name, setName] = useState("my-agent");
  const [templateId, setTemplateId] = useState<string | undefined>(templates[0]?.id);
  const createAgent = useCreateAgent();
  const submitting = createAgent.isPending;
  const anthropicSecrets = secrets.filter((s) => s.type === "anthropic");

  const submit = async () => {
    const trimmed = name.trim();
    if (trimmed && templateId) {
      await createAgent.mutateAsync({
        name: trimmed,
        templateId,
        secretIds: anthropicSecrets.map((s) => s.id),
        egressPreset: "trusted",
      });
    }
    onNext();
  };

  return (
    <StepShell
      title="Add your first agent"
      subtitle="Pick a template and name your agent. You can tweak everything later."
      onBack={onBack}
      primary={{
        label: submitting ? "Creating..." : "Next step",
        onClick: submit,
        disabled: submitting,
        icon: <ArrowRight />,
      }}
    >
      <div className="space-y-6">
        {anthropicSecrets.length === 0 && (
          <div className="rounded-lg border border-warning bg-warning-light p-3 flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-foreground">No provider configured</div>
              <div className="text-xs text-foreground/80">
                This agent will be created, but it won't be able to reach an AI model until
                you set up a provider. You can add one anytime from the Providers page or
                by going back a step.
              </div>
            </div>
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="wizard-agent-name">Name</Label>
          <Input
            id="wizard-agent-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-agent"
          />
        </div>
        <div className="space-y-2">
          <Label>Template</Label>
          {templates.length === 0 ? (
            <div className="text-xs text-muted-foreground rounded-lg border bg-muted/50 p-3">
              No templates available. You can still create a custom agent later.
            </div>
          ) : (
            <div className="grid gap-2">
              {templates.map((t) => {
                const selected = t.id === templateId;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTemplateId(t.id)}
                    className={cn(
                      "text-left rounded-lg border p-3 transition-colors",
                      selected
                        ? "border-primary bg-primary/5"
                        : "bg-card hover:bg-muted/50",
                    )}
                  >
                    <div className="text-sm font-semibold">{t.name}</div>
                    {t.description && (
                      <div className="text-xs text-muted-foreground mt-0.5">{t.description}</div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </StepShell>
  );
}

function ConnectionsStep({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const { data: oauthApps = [] } = useOAuthApps();

  return (
    <StepShell
      title="Add connections"
      subtitle="Optional — give your agent access to GitHub, Google Workspace, or other OAuth apps. You can do this anytime from the Connections page."
      onBack={onBack}
      primary={{ label: "Finish setup", onClick: onDone, icon: <Check /> }}
    >
      <div className="space-y-2">
        {oauthApps.length === 0 ? (
          <div className="rounded-lg border bg-muted/50 p-4 text-sm text-muted-foreground">
            No OAuth apps configured for this deployment. Connections can be added
            later from the Connections page.
          </div>
        ) : (
          oauthApps.map((app) => (
            <div key={app.id} className="flex items-center justify-between rounded-lg border bg-card p-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center shrink-0">
                  <Plug className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{app.displayName}</div>
                  <div className="text-xs text-muted-foreground truncate">{app.description}</div>
                </div>
              </div>
              <Button variant="outline" size="sm" disabled>
                Connect
              </Button>
            </div>
          ))
        )}
      </div>
    </StepShell>
  );
}

function StepShell({
  title,
  subtitle,
  children,
  onBack,
  primary,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onBack: () => void;
  primary?: { label: string; onClick: () => void; disabled?: boolean; icon?: React.ReactNode };
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-1">
        <h2 className="text-xl font-bold">{title}</h2>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      <div>{children}</div>
      <Separator />
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          Back
        </Button>
        <div className="flex-1" />
        {primary && (
          <Button onClick={primary.onClick} disabled={primary.disabled}>
            {primary.label} {primary.icon}
          </Button>
        )}
      </div>
    </div>
  );
}
