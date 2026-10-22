import { Cloud, DataCenter } from "@carbon/icons-react";
import type { ComponentType, SVGProps } from "react";

import {
  AnthropicIcon,
  BobFilledIcon,
  BobIcon,
  CurveBenderIcon,
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
  anthropic: {
    Icon: AnthropicIcon,
    bg: "bg-icon-clay",
  },
  openai: { Icon: OpenAIIcon, bg: "bg-icon-green" },
  "ibm-litellm": {
    Icon: LiteLLMIcon,
    bg: "bg-icon-litellm",
  },
  "curve-bender": {
    Icon: CurveBenderIcon,
    bg: "bg-icon-teal",
  },
  bob: { Icon: BobIcon, bg: "bg-icon-violet" },
  bedrock: { Icon: Cloud, bg: "bg-icon-ochre" },
  platform: { Icon: DataCenter, bg: "bg-icon-blue" },
};

const TILE_SIZE_CLASS: Record<"lg" | "md" | "sm", string> = {
  lg: "size-[68px]",
  md: "size-[38px]",
  sm: "size-5",
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: one preset can offer two providers a user tells
 * apart only by their rows, so a template may take its own shade of the
 * preset's tile. The glyph stays white on the tile whichever theme is up.
 */
const TEMPLATE_BG: Readonly<Record<string, string>> = {
  "curve-bender-deployment": "bg-icon-teal-deep",
};

export function CardIcon({
  provider,
  templateId,
  size = "md",
}: {
  provider: ProviderPresetType;
  templateId?: string;
  size?: "lg" | "md" | "sm";
}) {
  const { Icon: OutlineIcon, bg } = STYLES[provider];
  const tileBg = (templateId && TEMPLATE_BG[templateId]) || bg;
  const Icon =
    size === "sm" && provider === "bob" ? BobFilledIcon : OutlineIcon;
  return (
    <div
      aria-hidden="true"
      className={cn(
        "shrink-0 flex items-center justify-center",
        TILE_SIZE_CLASS[size],
        size !== "sm" && ["rounded-lg text-white", tileBg],
      )}
    >
      <Icon
        className={
          size === "sm" || provider === "ibm-litellm" ? "size-full" : "size-3/5"
        }
      />
    </div>
  );
}
