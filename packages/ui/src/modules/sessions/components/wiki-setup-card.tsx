import { Checkmark } from "@carbon/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SetupStep = "start" | "purpose" | "submitted";

interface WikiSetupCardProps {
  onSubmit?: (
    payload: { demo: true } | { name: string; purpose: string },
  ) => void;
}

export function WikiSetupCard({ onSubmit }: WikiSetupCardProps) {
  const [step, setStep] = useState<SetupStep>("start");
  const [wikiName, setWikiName] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [purposeInput, setPurposeInput] = useState("");

  function handleNameSubmit() {
    if (!nameInput.trim()) return;
    setWikiName(nameInput.trim());
    setStep("purpose");
  }

  function handlePurposeSubmit() {
    if (!purposeInput.trim()) return;
    setStep("submitted");
    onSubmit?.({ name: wikiName, purpose: purposeInput.trim() });
  }

  if (step === "submitted") return null;

  return (
    <div className="w-full rounded-2xl border border-border bg-gradient-to-br from-muted/60 to-card">
      {step === "purpose" && (
        <div className="flex items-center gap-1.5 px-5 pt-4">
          <StepDot done active={false} />
          <StepDot done={false} active={true} />
        </div>
      )}

      <div className="px-5 py-4">
        {step === "start" && (
          <div className="space-y-3">
            <p className="text-[14px] font-medium text-foreground">
              Name this knowledge base
            </p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleNameSubmit()}
                placeholder="e.g. Platform docs, Research notes"
                className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground placeholder:text-muted-foreground/50 outline-none transition-colors focus:border-accent"
                autoFocus
              />
              {nameInput.trim() && (
                <Button size="sm" onClick={handleNameSubmit}>
                  Next
                </Button>
              )}
            </div>
          </div>
        )}

        {step === "purpose" && (
          <div className="space-y-4">
            <CompletedField value={wikiName} />
            <div className="space-y-2">
              <p className="text-[14px] font-medium text-foreground">
                What knowledge will live here?
              </p>
              <p className="text-[14px] text-muted-foreground">
                A sentence or two about the topics or domain — this steers how I
                organise and tag things as I ingest sources.
              </p>
              <div className="flex flex-col gap-2 pt-1">
                <textarea
                  value={purposeInput}
                  onChange={(e) => setPurposeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handlePurposeSubmit();
                    }
                  }}
                  placeholder="e.g. Our API surface and deployment runbooks"
                  className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground placeholder:text-muted-foreground/50 outline-none transition-colors focus:border-accent"
                  rows={3}
                  autoFocus
                />
                {purposeInput.trim() && (
                  <div className="flex justify-end">
                    <Button size="sm" onClick={handlePurposeSubmit}>
                      Create
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StepDot({ done, active }: { done: boolean; active: boolean }) {
  return (
    <span
      className={cn(
        "h-1.5 rounded-full transition-all",
        done
          ? "w-1.5 bg-success"
          : active
            ? "w-4 bg-accent"
            : "w-1.5 bg-border",
      )}
    />
  );
}

function CompletedField({ value }: { value: string }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-1.5">
      <Checkmark size={16} className="text-success shrink-0" />
      <span className="text-[14px] font-medium text-foreground">{value}</span>
    </div>
  );
}
