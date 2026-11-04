import { Cloud } from "@carbon/icons-react";
import type { ComponentType, SVGProps } from "react";

import {
  AnthropicIcon,
  BedrockColorIcon,
  BobFilledIcon,
  BobHeadColorIcon,
  BobIcon,
  CurveBenderColorIcon,
  CurveBenderIcon,
  LiteLLMIcon,
  OpenAIIcon,
} from "@/components/brand-icons";
import { cn } from "@/lib/utils";

import type { ProviderPresetType } from "../../../types.js";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

/**
 * UNIT_BOUNDARY_DESCRIPTION: a tile shows the vendor's own full-colour mark,
 * the same in both themes; `Icon` is the one-colour glyph for the untiled
 * small size.
 */
const STYLES: Record<
  ProviderPresetType,
  { Icon: Icon; Mark: Icon; tile: string; mark: string }
> = {
  anthropic: {
    Icon: AnthropicIcon,
    Mark: AnthropicIcon,
    tile: "bg-white text-logo-anthropic",
    mark: "size-3/5",
  },
  openai: {
    Icon: OpenAIIcon,
    Mark: OpenAIIcon,
    tile: "bg-white text-logo-openai",
    mark: "size-3/5",
  },
  "ibm-litellm": {
    Icon: LiteLLMIcon,
    Mark: LiteLLMIcon,
    tile: "bg-logo-litellm text-white",
    mark: "size-full",
  },
  "curve-bender": {
    Icon: CurveBenderIcon,
    Mark: CurveBenderColorIcon,
    tile: "bg-white",
    mark: "size-3/5",
  },
  bob: {
    Icon: BobIcon,
    Mark: BobHeadColorIcon,
    tile: "bg-white",
    mark: "size-4/5",
  },
  bedrock: { Icon: Cloud, Mark: BedrockColorIcon, tile: "", mark: "size-full" },
};

type CardIconSize = "lg" | "md" | "sm" | "tile-md" | "tile-sm" | "tile-xs";

const TILE_SIZE_CLASS: Record<CardIconSize, string> = {
  lg: "size-[68px] rounded-lg",
  md: "size-[38px] rounded-lg",
  sm: "size-5",
  "tile-md": "size-8 rounded-md",
  "tile-sm": "size-5 rounded-[5px]",
  "tile-xs": "size-3.5 rounded-[3px]",
};

export function CardIcon({
  provider,
  size = "md",
}: {
  provider: ProviderPresetType;
  size?: CardIconSize;
}) {
  const { Icon, Mark, tile, mark } = STYLES[provider];
  if (size === "sm") {
    const Glyph = provider === "bob" ? BobFilledIcon : Icon;
    return (
      <div aria-hidden="true" className={cn("shrink-0", TILE_SIZE_CLASS.sm)}>
        <Glyph className="size-full" />
      </div>
    );
  }
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden ring-1 ring-border",
        TILE_SIZE_CLASS[size],
        tile,
      )}
    >
      <Mark className={mark} />
    </div>
  );
}
