import { Cloud } from "@carbon/icons-react";
import type { ComponentType, SVGProps } from "react";

import {
  AnthropicIcon,
  BobFilledIcon,
  BobIcon,
  LiteLLMIcon,
  OpenAIIcon,
} from "@/components/brand-icons";
import { cn } from "@/lib/utils";

import type { ProviderPresetType } from "../../../types.js";

const STYLES: Record<
  ProviderPresetType,
  {
    Icon: ComponentType<SVGProps<SVGSVGElement>>;
    bg: string;
  }
> = {
  anthropic: { Icon: AnthropicIcon, bg: "bg-icon-clay" },
  openai: { Icon: OpenAIIcon, bg: "bg-icon-green" },
  "ibm-litellm": { Icon: LiteLLMIcon, bg: "bg-icon-blue" },
  "curve-bender": { Icon: LiteLLMIcon, bg: "bg-icon-violet" },
  bob: { Icon: BobIcon, bg: "bg-icon-blue" },
  bedrock: { Icon: Cloud, bg: "bg-icon-ochre" },
};

const TILE_SIZE_CLASS: Record<"lg" | "md" | "sm", string> = {
  lg: "size-[68px]",
  md: "size-[38px]",
  sm: "size-5",
};

export function CardIcon({
  provider,
  size = "md",
}: {
  provider: ProviderPresetType;
  size?: "lg" | "md" | "sm";
}) {
  const { Icon: OutlineIcon, bg } = STYLES[provider];
  const Icon =
    size === "sm" && provider === "bob" ? BobFilledIcon : OutlineIcon;
  return (
    <div
      aria-hidden="true"
      className={cn(
        "shrink-0 flex items-center justify-center",
        TILE_SIZE_CLASS[size],
        size !== "sm" && ["rounded-lg text-white", bg],
      )}
    >
      <Icon className={size === "sm" ? "size-full" : "size-3/5"} />
    </div>
  );
}
