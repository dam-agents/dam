import { Checkmark } from "@carbon/icons-react";

import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import {
  PROVIDER_PRESET_TYPES,
  type ProviderPresetType,
  PROVIDERS,
} from "../../../types.js";
import { CardIcon } from "./shared/card-icon.js";

const COMING_SOON: { name: string; description: string }[] = [
  { name: "Google", description: "Powers Gemini CLI agents" },
];

const DESCRIPTIONS: Record<ProviderPresetType, string> = {
  anthropic: "Claude Code, Claude SDK, and any Anthropic-compatible client.",
  "ibm-litellm": "IBM's internal LiteLLM proxy — Claude on watsonx-routed AWS.",
  openai: "GPT-family models for Codex and OpenAI-compatible agents.",
  bob: "IBM Bob Shell endpoint with twin-secret credential injection.",
};

/**
 * Bare provider chooser — list of preset buttons + "Coming soon" section.
 * Used both as a standalone Dialog ({@link ProviderChooserDialog}) on the
 * Providers page and embedded inline inside the Add Agent dialog so the
 * two surfaces stay in sync.
 */
export function ProviderChooserList({
  configuredTypes,
  onPick,
}: {
  configuredTypes: Set<ProviderPresetType>;
  onPick: (type: ProviderPresetType) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2">
        {PROVIDER_PRESET_TYPES.map((id) => {
          const meta = PROVIDERS[id];
          const configured = configuredTypes.has(id);
          return (
            <li key={id}>
              <button
                type="button"
                disabled={configured}
                onClick={() => onPick(id)}
                className={cn(
                  "w-full flex items-center gap-3 rounded-xl border bg-background px-4 py-3 text-left transition-colors",
                  configured
                    ? "opacity-60 cursor-not-allowed"
                    : "hover:border-primary hover:bg-muted",
                )}
              >
                <CardIcon provider={id} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-semibold text-foreground">
                      {meta.displayName}
                    </span>
                    {configured && (
                      <Badge variant="secondary" className="gap-1">
                        <Checkmark className="h-3 w-3" /> Connected
                      </Badge>
                    )}
                  </div>
                  <div className="text-[12px] text-muted-foreground leading-snug mt-0.5">
                    {DESCRIPTIONS[id]}
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      <div>
        <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground mb-2">
          Coming Soon
        </div>
        <ul className="flex flex-col gap-2">
          {COMING_SOON.map((p) => (
            <li
              key={p.name}
              className="flex items-center gap-3 rounded-xl border bg-background px-4 py-3 opacity-60"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-semibold text-foreground">
                    {p.name}
                  </span>
                  <Badge variant="secondary">Coming soon</Badge>
                </div>
                <div className="text-[12px] text-muted-foreground leading-snug mt-0.5">
                  {p.description}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * Standalone Dialog wrapper for {@link ProviderChooserList}. Used on the
 * Providers page where there's no parent modal to host the chooser inline.
 */
export function ProviderChooserDialog({
  open,
  onClose,
  configuredTypes,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  configuredTypes: Set<ProviderPresetType>;
  onPick: (type: ProviderPresetType) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Set up a provider</DialogTitle>
          <DialogDescription>
            Pick a provider to add an API key for. Keys are encrypted in the
            cluster and never visible to the agent runtime.
          </DialogDescription>
        </DialogHeader>
        <ProviderChooserList configuredTypes={configuredTypes} onPick={onPick} />
      </DialogContent>
    </Dialog>
  );
}
