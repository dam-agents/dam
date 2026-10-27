import type { HarnessFamily } from "api-server-api";
import type { ComponentType, SVGProps } from "react";

import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import {
  BobFilledIcon,
  ClaudeIcon,
  CodexIcon,
  CopilotIcon,
  HermesIcon,
  PiIcon,
} from "./brand-icons.js";

export const HARNESS_ICONS: Record<
  HarnessFamily,
  {
    label: string;
    Icon: ComponentType<SVGProps<SVGSVGElement>>;
    bg: string;
    fg: string;
    iconClass?: string;
  }
> = {
  bob: {
    label: "Bob",
    Icon: BobFilledIcon,
    bg: "bg-icon-violet",
    fg: "text-icon-violet",
  },
  "claude-code": {
    label: "Claude",
    Icon: ClaudeIcon,
    bg: "bg-icon-clay",
    fg: "text-icon-clay",
    iconClass: "scale-110",
  },
  codex: {
    label: "Codex",
    Icon: CodexIcon,
    bg: "bg-icon-green",
    fg: "text-icon-green",
    iconClass: "scale-90",
  },
  copilot: {
    label: "Copilot",
    Icon: CopilotIcon,
    bg: "bg-icon-teal",
    fg: "text-icon-teal",
  },
  hermes: {
    label: "Hermes",
    Icon: HermesIcon,
    bg: "bg-icon-ochre",
    fg: "text-icon-ochre",
  },
  pi: {
    label: "Pi",
    Icon: PiIcon,
    bg: "bg-icon-blue",
    fg: "text-icon-blue",
  },
};

export const HARNESS_ORDER = Object.keys(HARNESS_ICONS) as HarnessFamily[];

export function HarnessIcons({
  harnesses = HARNESS_ORDER,
  size = "md",
  focusable = size !== "xs",
  tooltip,
  className,
}: {
  harnesses?: readonly string[];
  size?: "xs" | "sm" | "md";
  focusable?: boolean;
  /** UNIT_BOUNDARY_DESCRIPTION: gives each icon a tooltip that says this, focusable or not; without it, a focusable icon's tooltip is its name. */
  tooltip?: (label: string) => string;
  className?: string;
}) {
  if (harnesses.length === 0) return null;
  return (
    <span className={cn("flex items-center gap-2", className)}>
      {harnesses
        .filter((name): name is HarnessFamily =>
          Object.keys(HARNESS_ICONS).includes(name),
        )
        .map((name) => {
          const { Icon, label, bg, iconClass } = HARNESS_ICONS[name];
          const icon = (
            <span
              key={name}
              role="img"
              aria-label={label}
              tabIndex={focusable ? 0 : undefined}
              className={cn(
                "inline-flex shrink-0 items-center justify-center",
                size === "xs"
                  ? "size-4"
                  : size === "sm"
                    ? "size-5"
                    : ["size-7 rounded-lg text-white", bg],
              )}
            >
              <Icon
                aria-hidden="true"
                className={cn(
                  size === "md" ? "size-5" : "size-full",
                  iconClass,
                )}
              />
            </span>
          );
          return !focusable && !tooltip ? (
            icon
          ) : (
            <Tooltip key={name} content={tooltip ? tooltip(label) : label}>
              {icon}
            </Tooltip>
          );
        })}
    </span>
  );
}
