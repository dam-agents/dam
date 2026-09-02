import { DialogFooter, DialogHeader, Modal } from "@/components/modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/section-label";

import type { KbIntent } from "../lib/kb-intents.js";
import { KB_TEMPLATES } from "../lib/kb-templates.js";

interface Props {
  intent: KbIntent | null;
  onClose: () => void;
  onCreateFromIntent: (intent: KbIntent) => void;
  onTryExample: (intent: KbIntent) => void;
}

export function KbIntentDetailSheet({
  intent,
  onClose,
  onCreateFromIntent,
  onTryExample,
}: Props) {
  if (!intent) return null;

  const Icon = intent.icon;
  const suggestedTemplate = KB_TEMPLATES.find(
    (t) => t.id === intent.suggestedType,
  );

  return (
    <Modal widthClass="w-[720px]">
      <div className="flex min-h-0 flex-1 flex-col">
        <DialogHeader onClose={onClose} divided>
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border bg-muted">
              <Icon size={16} className="text-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2.5">
                <h2 className="text-lg font-semibold text-foreground">
                  {intent.title}
                </h2>
                <Badge variant="muted" size="sm">
                  Knowledge base
                </Badge>
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {intent.tagline}
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <p className="text-sm leading-relaxed text-muted-foreground">
            {intent.outcome}
          </p>

          {suggestedTemplate && (
            <div className="mt-6">
              <SectionLabel spaced>Suggested template</SectionLabel>
              <div className="rounded-lg border border-border bg-muted/50 px-4 py-3">
                <p className="text-sm font-medium text-foreground">
                  {suggestedTemplate.name}
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {suggestedTemplate.description}
                </p>
              </div>
            </div>
          )}

          {intent.recommendedConnections.length > 0 && (
            <div className="mt-6">
              <SectionLabel spaced>Recommended connections</SectionLabel>
              <div className="flex flex-col gap-2">
                {intent.recommendedConnections.map((connId) => (
                  <div
                    key={connId}
                    className="rounded-lg border border-border bg-muted/50 px-4 py-3"
                  >
                    <p className="text-sm font-medium capitalize text-foreground">
                      {connId}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onTryExample(intent)}>
            Try an example
          </Button>
          <Button onClick={() => onCreateFromIntent(intent)}>
            Create knowledge base
          </Button>
        </DialogFooter>
      </div>
    </Modal>
  );
}
