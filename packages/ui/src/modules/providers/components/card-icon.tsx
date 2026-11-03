import { Cloud } from "@carbon/icons-react";
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
    fg: string;
  }
> = {
  anthropic: {
    Icon: AnthropicIcon,
    fg: "text-logo-anthropic",
  },
  openai: {
    Icon: OpenAIIcon,
    fg: "text-logo-openai",
  },
  "ibm-litellm": {
    Icon: LiteLLMIcon,
    fg: "text-logo-litellm",
  },
  "curve-bender": {
    Icon: CurveBenderIcon,
    fg: "text-logo-cb",
  },
  bob: { Icon: BobIcon, fg: "text-logo-ibm" },
  bedrock: { Icon: Cloud, fg: "text-logo-aws" },
};

type CardIconSize = "lg" | "md" | "sm" | "tile-sm" | "tile-xs";

const TILE_SIZE_CLASS: Record<CardIconSize, string> = {
  lg: "size-[68px] rounded-lg",
  md: "size-[38px] rounded-lg",
  sm: "size-5",
  "tile-sm": "size-5 rounded-[5px]",
  "tile-xs": "size-3.5 rounded-[3px]",
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: one preset can offer two providers a user tells
 * apart only by their rows, so a template may take its own shade of the
 * preset's mark. The tile stays white whichever theme is up, so the vendor's
 * own colours read the same in both.
 */
const TEMPLATE_FG: Readonly<Record<string, string>> = {
  "curve-bender-deployment": "text-logo-cb-deep",
};

export function CardIcon({
  provider,
  templateId,
  size = "md",
}: {
  provider: ProviderPresetType;
  templateId?: string;
  size?: CardIconSize;
}) {
  const { Icon: OutlineIcon, fg } = STYLES[provider];
  const tileFg = (templateId && TEMPLATE_FG[templateId]) || fg;
  const Icon =
    size === "sm" && provider === "bob" ? BobFilledIcon : OutlineIcon;
  return (
    <div
      aria-hidden="true"
      className={cn(
        "shrink-0 flex items-center justify-center",
        TILE_SIZE_CLASS[size],
        size !== "sm" && ["bg-white ring-1 ring-border", tileFg],
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
