import { ArrowLeft, ArrowRight, UserMultiple } from "@carbon/icons-react";
import type { KnowledgeBaseTemplateId } from "api-server-api";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { routeToPath } from "../../platform/lib/routes.js";
import { CardGrid } from "../../sandboxes/components/card-list.js";
import {
  ConnectionsSetupSection,
  NameSection,
  ProviderSection,
} from "../../sandboxes/components/setup/setup-sections.js";
import { KbTemplateCard } from "../../sandboxes/components/steps/kb-template-card.js";
import {
  CardIconTile,
  StackedCard,
} from "../../sandboxes/components/steps/stacked-card.js";
import { StickyFooterLayout } from "../../sandboxes/components/sticky-footer-layout.js";
import { useSetupForm } from "../../sandboxes/hooks/use-setup-form.js";
import { KINDED_HARNESS_TEMPLATE_ID } from "../../sandboxes/lib/image-catalogue.js";
import { setupProviderPolicy } from "../../sandboxes/lib/setup-policy.js";
import { useCreateKnowledgeBase } from "../api/mutations.js";
import { KB_INTENTS, type KbIntent } from "../lib/kb-intents.js";
import { DEFAULT_KB_TEMPLATE_ID, KB_TEMPLATES } from "../lib/kb-templates.js";

const RETURN_PATH = routeToPath({ view: "knowledge-base-new" });
const STEP_COUNT = 4;

const AUDIENCE_OPTIONS = [
  { id: "just-me" as const, label: "Just me", icon: undefined },
  { id: "my-team" as const, label: "My team", icon: UserMultiple },
];

export function KnowledgeBaseSetupView() {
  const [step, setStep] = useState(0);

  const pendingIntent = useStore((s) => s.pendingKbIntent);
  const setPendingKbIntent = useStore((s) => s.setPendingKbIntent);

  const { form, update, reset } = useSetupForm(
    "knowledge-base",
    {
      templateId: KINDED_HARNESS_TEMPLATE_ID,
      kbTemplateId: DEFAULT_KB_TEMPLATE_ID,
      intentId: pendingIntent?.id ?? null,
    },
    RETURN_PATH,
  );

  const createKnowledgeBase = useCreateKnowledgeBase();
  const openKnowledgeBase = useStore((s) => s.openKnowledgeBase);
  const setView = useStore((s) => s.setView);

  const canAdvance = (() => {
    switch (step) {
      case 0:
        return form.intentId !== null;
      case 1:
        return form.kbTemplateId !== null && form.audience !== null;
      case 2:
        return true;
      case 3:
        return (
          form.name.trim().length > 0 &&
          form.providerRef !== null &&
          !createKnowledgeBase.isPending
        );
      default:
        return false;
    }
  })();

  const selectedIntent = KB_INTENTS.find((i) => i.id === form.intentId);

  const handleIntentSelect = (intent: KbIntent) => {
    update({
      intentId: intent.id,
      kbTemplateId: intent.suggestedType,
    });
  };

  const create = async () => {
    if (!canAdvance) return;
    const connectionIds = [
      ...new Set([
        ...form.connectionIds,
        ...(form.providerRef ? [form.providerRef.id] : []),
      ]),
    ];
    try {
      const agent = await createKnowledgeBase.mutateAsync({
        name: form.name.trim(),
        templateId: form.templateId ?? KINDED_HARNESS_TEMPLATE_ID,
        kbTemplateId: form.kbTemplateId ?? DEFAULT_KB_TEMPLATE_ID,
        egressPreset: "trusted",
        ...(connectionIds.length ? { connectionIds } : {}),
      });
      reset();
      setPendingKbIntent(null);
      openKnowledgeBase(agent.id);
    } catch {}
  };

  const next = () => {
    if (step === STEP_COUNT - 1) {
      void create();
      return;
    }
    setStep((s) => Math.min(s + 1, STEP_COUNT - 1));
  };

  const back = () => {
    if (step === 0) {
      setView("knowledge-bases");
      return;
    }
    setStep((s) => Math.max(s - 1, 0));
  };

  return (
    <StickyFooterLayout
      footer={
        <div className="flex w-full items-center justify-between">
          <Button variant="ghost" onClick={back}>
            <ArrowLeft size={16} />
            Back
          </Button>
          <div className="flex items-center gap-1.5">
            {Array.from({ length: STEP_COUNT }, (_, i) => (
              <div
                key={i}
                className={cn(
                  "h-1.5 w-1.5 rounded-full transition-colors",
                  i === step ? "bg-foreground" : "bg-muted-foreground/30",
                )}
              />
            ))}
          </div>
          <Button onClick={next} disabled={!canAdvance}>
            {step === STEP_COUNT - 1
              ? createKnowledgeBase.isPending
                ? "Creating…"
                : "Create knowledge base"
              : "Continue"}
            {step < STEP_COUNT - 1 && <ArrowRight size={16} />}
          </Button>
        </div>
      }
    >
      <div className="mx-auto w-full max-w-[720px] px-4 py-6 md:px-8 md:py-10">
        {step === 0 && (
          <StepIntent
            selectedId={form.intentId}
            onSelect={handleIntentSelect}
          />
        )}
        {step === 1 && (
          <StepTypeAndAudience
            kbTemplateId={form.kbTemplateId}
            audience={form.audience}
            onTemplateChange={(kbTemplateId) => update({ kbTemplateId })}
            onAudienceChange={(audience) => update({ audience })}
          />
        )}
        {step === 2 && (
          <StepConnections
            connectionIds={form.connectionIds}
            onToggle={(id, granted) =>
              update({
                connectionIds: granted
                  ? [...new Set([...form.connectionIds, id])]
                  : form.connectionIds.filter((x) => x !== id),
              })
            }
            intent={selectedIntent}
          />
        )}
        {step === 3 && (
          <StepNameAndProvider
            name={form.name}
            onNameChange={(name) => update({ name })}
            providerRef={form.providerRef}
            onProviderChange={(providerRef) => update({ providerRef })}
            intent={selectedIntent}
          />
        )}
      </div>
    </StickyFooterLayout>
  );
}

function StepIntent({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (intent: KbIntent) => void;
}) {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-foreground">
        What do you want your knowledge base to do?
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Pick an intent to get started. This shapes the recommended template and
        connections.
      </p>
      <div className="mt-6">
        <CardGrid>
          {KB_INTENTS.map((intent) => {
            const Icon = intent.icon;
            return (
              <StackedCard
                key={intent.id}
                icon={<CardIconTile icon={Icon} />}
                title={intent.title}
                description={intent.tagline}
                selected={selectedId === intent.id}
                onSelect={() => onSelect(intent)}
                testId={`kb-intent-${intent.id}`}
              />
            );
          })}
        </CardGrid>
      </div>
    </div>
  );
}

function StepTypeAndAudience({
  kbTemplateId,
  audience,
  onTemplateChange,
  onAudienceChange,
}: {
  kbTemplateId: KnowledgeBaseTemplateId | null;
  audience: "just-me" | "my-team" | null;
  onTemplateChange: (id: KnowledgeBaseTemplateId) => void;
  onAudienceChange: (audience: "just-me" | "my-team") => void;
}) {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-foreground">
        Choose a type and audience
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The template shapes how your knowledge base organizes information. The
        audience determines who can access it.
      </p>

      <section className="mt-6">
        <SectionLabel spaced>Template</SectionLabel>
        <CardGrid>
          {KB_TEMPLATES.map((template) => (
            <KbTemplateCard
              key={template.id}
              template={template}
              selected={kbTemplateId === template.id}
              onSelect={() => onTemplateChange(template.id)}
            />
          ))}
        </CardGrid>
      </section>

      <section className="mt-8">
        <SectionLabel spaced>Who is this for?</SectionLabel>
        <CardGrid>
          {AUDIENCE_OPTIONS.map((opt) => (
            <StackedCard
              key={opt.id}
              icon={
                opt.icon ? (
                  <CardIconTile icon={opt.icon} />
                ) : (
                  <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg border border-border bg-card">
                    <span className="text-sm font-medium text-muted-foreground">
                      1
                    </span>
                  </div>
                )
              }
              title={opt.label}
              selected={audience === opt.id}
              onSelect={() => onAudienceChange(opt.id)}
              testId={`kb-audience-${opt.id}`}
            />
          ))}
        </CardGrid>
      </section>
    </div>
  );
}

function StepConnections({
  connectionIds,
  onToggle,
  intent,
}: {
  connectionIds: string[];
  onToggle: (id: string, granted: boolean) => void;
  intent: KbIntent | undefined;
}) {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-foreground">
        Connect a source
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {intent?.recommendedConnections.length
          ? "Add the connections your knowledge base will read from. You can add more later."
          : "Connect a source so your knowledge base has something to work with. You can skip this and add sources later."}
      </p>

      <div className="mt-6">
        <ConnectionsSetupSection
          connectionIds={connectionIds}
          onToggle={onToggle}
          oauthReturnView={RETURN_PATH}
        />
      </div>
    </div>
  );
}

function StepNameAndProvider({
  name,
  onNameChange,
  providerRef,
  onProviderChange,
  intent,
}: {
  name: string;
  onNameChange: (name: string) => void;
  providerRef: { id: string } | null;
  onProviderChange: (ref: { id: string } | null) => void;
  intent: KbIntent | undefined;
}) {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-foreground">
        Name and finish
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Give your knowledge base a name and choose a provider.
      </p>

      <div className="mt-6">
        <NameSection value={name} onChange={onNameChange} />
        <ProviderSection
          selected={providerRef}
          onSelect={onProviderChange}
          policy={setupProviderPolicy("knowledge-base")}
        />

        {intent && (
          <section className="mt-2 rounded-lg border border-border bg-muted/30 p-4">
            <p className="text-sm font-medium text-foreground">Summary</p>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              <li>Intent: {intent.title}</li>
              {name.trim() && <li>Name: {name.trim()}</li>}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
