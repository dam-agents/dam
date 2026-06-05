import { Check } from "lucide-react";
import type { ReactNode } from "react";

import type { LlmProvider, LlmProviderId } from "../../lib/llm-providers.js";

export function ProviderPicker({
  providers,
  selected,
  onSelect,
  renderSelected,
}: {
  providers: readonly LlmProvider[];
  selected: LlmProviderId | null;
  onSelect: (provider: LlmProvider) => void;
  renderSelected?: (provider: LlmProvider) => ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      {providers.map((provider) => {
        const active = provider.id === selected;
        return (
          <div
            key={provider.id}
            className={`rounded-lg border transition-colors ${
              active
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50"
            }`}
          >
            <button
              type="button"
              onClick={() => onSelect(provider)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left"
            >
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold text-foreground">
                  {provider.label}
                </div>
                <div className="text-[12px] text-muted-foreground">
                  {provider.description}
                </div>
              </div>
              {active && <Check size={16} className="text-primary shrink-0" />}
            </button>
            {active && renderSelected && (
              <div className="border-t border-primary/20 px-4 py-3">
                {renderSelected(provider)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
