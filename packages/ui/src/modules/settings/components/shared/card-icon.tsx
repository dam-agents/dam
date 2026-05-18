import { Bee } from "@carbon/icons-react";

import { cn } from "@/lib/utils";

import type { ProviderPresetType } from "../../../../types.js";
import {
  AnthropicIcon,
  LiteLLMIcon,
  OpenAIIcon,
} from "../brand-icons.js";

/**
 * Per-provider brand mark — a small (40×40) tile with the provider's
 * canonical logo and brand color. Used in connected/edit/wizard chrome
 * across the four provider cards. The {@link ProviderPresetType} key
 * picks both the icon and the background tint, so adding a new preset
 * is a single new entry below.
 */
const STYLES: Record<
  ProviderPresetType,
  { Icon: React.ComponentType<{ className?: string }>; bg: string; iconClass: string }
> = {
  anthropic: {
    Icon: AnthropicIcon,
    bg: "bg-[#D97757]",
    iconClass: "w-5 h-5 text-white",
  },
  openai: {
    Icon: OpenAIIcon,
    bg: "bg-foreground",
    iconClass: "w-5 h-5 text-background",
  },
  "ibm-litellm": {
    Icon: LiteLLMIcon,
    bg: "bg-muted",
    iconClass: "text-[24px] leading-none",
  },
  bob: {
    // Carbon's Bee glyph (IBM BeeAI mascot) on a warm amber tile.
    Icon: Bee,
    bg: "bg-[#FBBF24]",
    iconClass: "w-6 h-6 text-[#1F2937]",
  },
};

export function CardIcon({ provider }: { provider: ProviderPresetType }) {
  const style = STYLES[provider];
  const Icon = style.Icon;
  return (
    <div
      className={cn(
        "w-10 h-10 shrink-0 rounded-lg flex items-center justify-center",
        style.bg,
      )}
    >
      <Icon className={style.iconClass} />
    </div>
  );
}
