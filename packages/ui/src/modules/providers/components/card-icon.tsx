import {
  AnthropicIcon,
  BobIcon,
  LiteLLMIcon,
  OpenAIIcon,
} from "@/components/brand-icons";
import { cn } from "@/lib/utils";

import type { ProviderPresetType } from "../../../types.js";

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
    iconClass: "text-2xl leading-none",
  },
  bob: {
    Icon: BobIcon,
    bg: "",
    iconClass: "w-full h-full",
  },
  "bob-inference": {
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
  "bob-inference": "",
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
          size === "lg" && LARGE_ICON_CLASS[provider],
          size === "sm" &&
            provider !== "bob" &&
            provider !== "bob-inference" &&
            (provider === "ibm-litellm" ? "!text-base" : "!w-3.5 !h-3.5"),
        )}
      />
    </div>
  );
}
