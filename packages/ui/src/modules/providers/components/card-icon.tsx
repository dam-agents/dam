import { Cloud } from "@carbon/icons-react";

import {
  AnthropicIcon,
  BobIcon,
  LiteLLMIcon,
  OpenAIIcon,
} from "@/components/brand-icons";
import { cn } from "@/lib/utils";

import type { ProviderPresetType } from "../../../types.js";

const LITELLM_STYLE = {
  Icon: LiteLLMIcon,
  bg: "bg-muted",
  iconClass: "text-2xl leading-none",
  lgIconClass: "!text-[40px]",
  smIconClass: "!text-base",
};

const STYLES: Record<
  ProviderPresetType,
  {
    Icon: React.ComponentType<{ className?: string }>;
    bg: string;
    iconClass: string;
    lgIconClass: string;
    smIconClass: string;
  }
> = {
  anthropic: {
    Icon: AnthropicIcon,
    bg: "bg-foreground",
    iconClass: "w-5 h-5 text-background",
    lgIconClass: "!w-8 !h-8",
    smIconClass: "!w-3.5 !h-3.5",
  },
  openai: {
    Icon: OpenAIIcon,
    bg: "bg-foreground",
    iconClass: "w-5 h-5 text-background",
    lgIconClass: "!w-8 !h-8",
    smIconClass: "!w-3.5 !h-3.5",
  },
  "ibm-litellm": LITELLM_STYLE,
  "curve-bender": LITELLM_STYLE,
  bob: {
    Icon: BobIcon,
    bg: "",
    iconClass: "w-full h-full",
    lgIconClass: "",
    smIconClass: "",
  },
  bedrock: {
    Icon: Cloud,
    bg: "bg-foreground",
    iconClass: "w-5 h-5 text-background",
    lgIconClass: "!w-8 !h-8",
    smIconClass: "!w-3.5 !h-3.5",
  },
};

const TILE_SIZE_CLASS: Record<"lg" | "md" | "sm", string> = {
  lg: "w-[68px] h-[68px]",
  md: "w-[38px] h-[38px]",
  sm: "w-7 h-7",
};

export function CardIcon({
  provider,
  size = "md",
}: {
  provider: ProviderPresetType;
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
          size === "lg" && style.lgIconClass,
          size === "sm" && style.smIconClass,
        )}
      />
    </div>
  );
}
