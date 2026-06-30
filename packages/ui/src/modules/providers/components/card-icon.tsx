import {
  AnthropicIcon,
  BobIcon,
  LiteLLMIcon,
  OpenAIIcon,
} from "@/components/brand-icons";
import { cn } from "@/lib/utils";

import type { ProviderPresetType } from "../../../types.js";

/**
 * Per-provider brand mark — a small (40×40) tile with the provider's
 * canonical logo and brand color. Used in connected/edit/wizard chrome
 * across the four provider cards. The {@link ProviderPresetType} key
 * picks both the icon and the background tint, so adding a new preset
 * is a single new entry below. Bob ships its own complete tile (white
 * background, border, rounded corners), so it sits on a transparent
 * wrapper and fills it.
 */
const STYLES: Record<
  ProviderPresetType,
  {
    Icon: React.ComponentType<{ className?: string }>;
    bg: string;
    iconClass: string;
  }
> = {
  anthropic: {
    Icon: AnthropicIcon,
    bg: "bg-foreground",
    iconClass: "w-5 h-5 text-background",
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
    Icon: BobIcon,
    bg: "",
    iconClass: "w-full h-full",
  },
};

const TILE_SIZE_CLASS: Record<"lg" | "md" | "sm", string> = {
  lg: "w-[68px] h-[68px]",
  md: "w-[38px] h-[38px]",
  sm: "w-7 h-7",
};

const LARGE_ICON_CLASS: Record<ProviderPresetType, string> = {
  anthropic: "!w-8 !h-8",
  openai: "!w-8 !h-8",
  "ibm-litellm": "!text-[40px]",
  bob: "",
};

export function CardIcon({
  provider,
  size = "md",
}: {
  provider: ProviderPresetType;
  /** "lg" = 68×68 (provider connect modal header). "md" = 40×40 (default,
   *  used in provider cards). "sm" = 28×28 (compact use inside dropdown rows /
   *  inline labels). The brand mark inside scales proportionally so it stays
   *  centered. */
  size?: "lg" | "md" | "sm";
}) {
  const style = STYLES[provider];
  const Icon = style.Icon;
  return (
    <div
      className={cn(
        "shrink-0 rounded-lg flex items-center justify-center",
        TILE_SIZE_CLASS[size],
        style.bg,
      )}
    >
      <Icon
        className={cn(
          style.iconClass,
          size === "lg" && LARGE_ICON_CLASS[provider],
          size === "sm" &&
            provider !== "bob" &&
            (provider === "ibm-litellm" ? "!text-[16px]" : "!w-3.5 !h-3.5"),
        )}
      />
    </div>
  );
}
