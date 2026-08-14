import { Chemistry } from "@carbon/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ExperimentSetupCardProps {
  goal?: string;
  onGoalSelected?: (goal: string) => void;
  onSubmit?: (payload: { goal: string; imageIds: string[] }) => void;
}

const GOAL_SUGGESTIONS = [
  "Evolve a prompt scorer",
  "Optimize a sorting algorithm",
  "Sweep hyperparameters for a model",
  "Benchmark approaches against a task",
];

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

export function ExperimentSetupCard({
  goal,
  onGoalSelected,
  onSubmit,
}: ExperimentSetupCardProps) {
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);

  const step = goal ? "images" : "goal";

  function handleGoalSelect(value: string) {
    onGoalSelected?.(value);
  }

  function handleStartExperiment() {
    if (!goal) return;
    setSubmitted(true);
    onSubmit?.({ goal, imageIds: selectedImages });
  }

  function toggleImage(id: string) {
    setSelectedImages((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  if (submitted) return null;

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
                Pick a common goal or describe your own below.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {GOAL_SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => handleGoalSelect(suggestion)}
                  className={cn(
                    "rounded-lg border border-border/80 bg-card px-3 py-2 text-[14px] text-foreground transition-all duration-200",
                    "hover:border-foreground hover:shadow-md",
                  )}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === "images" && (
          <div className="space-y-4 animate-in fade-in slide-in-from-right-3 duration-300">
            <div className="space-y-3">
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
                        <Chemistry size={16} />
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

            <div className="flex items-center justify-between pt-1">
              {selectedImages.length > 0 ? (
                <>
                  <span className="text-[14px] text-muted-foreground">
                    {selectedImages.length === 1
                      ? "1 framework selected"
                      : `${selectedImages.length} frameworks — horse race mode`}
                  </span>
                  <Button size="sm" onClick={handleStartExperiment}>
                    {selectedImages.length === 1
                      ? "Start experiment"
                      : "Start horse race"}
                  </Button>
                </>
              ) : (
                <>
                  <span />
                  <button
                    type="button"
                    onClick={handleStartExperiment}
                    className="text-[14px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Skip — let the agent decide →
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
