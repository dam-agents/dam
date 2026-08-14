import { Checkmark, Chemistry } from "@carbon/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SetupStep = "goal" | "images" | "submitted";

interface ExperimentSetupCardProps {
  onSubmit?: (
    payload: { demo: true } | { goal: string; imageIds: string[] },
  ) => void;
}

const PRECONFIGURED_IMAGES = [
  {
    id: "nous",
    name: "NOUS",
    description: "Hypothesis-driven experimentation",
    tags: ["Any provider"],
  },
  {
    id: "openevolve",
    name: "OpenEvolve",
    description: "Evolutionary code optimization",
    tags: ["OpenAI-compatible"],
  },
  {
    id: "shinkaevolve",
    name: "ShinkaEvolve",
    description: "Sample-efficient program optimization",
    tags: ["OpenAI-compatible"],
  },
  {
    id: "gepa",
    name: "GEPA",
    description: "Reflective prompt & text optimization",
    tags: ["Any provider"],
  },
  {
    id: "k-search",
    name: "K-Search",
    description: "LLM-driven GPU kernel optimization",
    tags: [],
  },
];

export function ExperimentSetupCard({ onSubmit }: ExperimentSetupCardProps) {
  const [step, setStep] = useState<SetupStep>("goal");
  const [goal, setGoal] = useState("");
  const [goalInput, setGoalInput] = useState("");
  const [selectedImages, setSelectedImages] = useState<string[]>([]);

  function handleGoalSubmit() {
    if (!goalInput.trim()) return;
    setGoal(goalInput.trim());
    setStep("images");
  }

  function handleStartExperiment() {
    if (selectedImages.length === 0) return;
    setStep("submitted");
    onSubmit?.({ goal, imageIds: selectedImages });
  }

  function toggleImage(id: string) {
    setSelectedImages((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  if (step === "submitted") return null;

  const currentStepIndex = step === "goal" ? 0 : 1;
  const totalSteps = 2;

  return (
    <div className="w-full rounded-2xl border border-border bg-gradient-to-br from-muted/60 to-card overflow-hidden transition-all duration-300">
      {/* Progress dots */}
      <div className="flex items-center gap-1.5 px-5 pt-4 pb-1">
        {Array.from({ length: totalSteps }, (_, i) => (
          <span
            key={i}
            className={cn(
              "rounded-full transition-all duration-500 ease-out",
              i < currentStepIndex
                ? "h-1.5 w-1.5 bg-accent"
                : i === currentStepIndex
                  ? "h-1.5 w-6 bg-accent"
                  : "h-1.5 w-1.5 bg-border",
            )}
          />
        ))}
      </div>

      <div className="px-5 pb-5 pt-3">
        {step === "goal" && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="space-y-1">
              <h3 className="text-[15px] font-semibold tracking-tight text-foreground">
                What do you want to optimize?
              </h3>
              <p className="text-[14px] text-muted-foreground">
                Describe your goal and we'll match you with the right framework.
              </p>
            </div>

            <div className="relative">
              <input
                type="text"
                value={goalInput}
                onChange={(e) => setGoalInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleGoalSubmit()}
                placeholder="e.g. Evolve a prompt scorer, optimize a sorting algorithm..."
                className="w-full rounded-xl border border-border/80 bg-card px-4 py-3 text-[14px] text-foreground placeholder:text-muted-foreground/50 outline-none transition-all duration-200 focus:border-foreground/20 focus:ring-1 focus:ring-foreground/5"
                autoFocus
              />
              {goalInput.trim() && (
                <div className="absolute right-2 top-1/2 -translate-y-1/2 animate-in fade-in zoom-in-90 duration-200">
                  <Button size="sm" onClick={handleGoalSubmit}>
                    Next
                  </Button>
                </div>
              )}
            </div>

          </div>
        )}

        {step === "images" && (
          <div className="space-y-4 animate-in fade-in slide-in-from-right-3 duration-300">
            <div className="space-y-3">
              <CompletedGoal value={goal} />

              <div className="space-y-1">
                <h3 className="text-[15px] font-semibold tracking-tight text-foreground">
                  Choose your framework
                </h3>
                <p className="text-[14px] text-muted-foreground">
                  Select multiple to horse-race them against each other
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {PRECONFIGURED_IMAGES.map((img) => {
                const selected = selectedImages.includes(img.id);
                return (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => toggleImage(img.id)}
                    className={cn(
                      "group relative flex flex-col gap-2 rounded-xl border p-3.5 text-left transition-all duration-200",
                      selected
                        ? "border-foreground bg-card shadow-lg"
                        : "border-border/80 bg-card hover:shadow-lg",
                    )}
                  >
                    <div className="flex items-start">
                      <div className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        <Chemistry size={14} />
                      </div>
                    </div>
                    <div className="space-y-0.5">
                      <p className="text-[14px] font-semibold text-foreground">
                        {img.name}
                      </p>
                      <p className="text-[13px] leading-snug text-muted-foreground">
                        {img.description}
                      </p>
                    </div>
                    {img.tags.length > 0 && (
                      <span className="inline-flex self-start rounded-full bg-muted/80 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {img.tags[0]}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {selectedImages.length > 0 && (
              <div className="flex items-center justify-between pt-1 animate-in fade-in slide-in-from-bottom-2 duration-200">
                <span className="text-[13px] text-muted-foreground">
                  {selectedImages.length === 1
                    ? "1 framework selected"
                    : `${selectedImages.length} frameworks — horse race mode`}
                </span>
                <Button size="sm" onClick={handleStartExperiment}>
                  {selectedImages.length === 1
                    ? "Start experiment"
                    : "Start horse race"}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CompletedGoal({ value }: { value: string }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-lg bg-card px-3 py-1.5 border border-border/80">
      <Checkmark size={12} className="text-foreground/60 shrink-0" />
      <span className="text-[13px] font-medium text-foreground">{value}</span>
    </div>
  );
}
