import type { HarnessFamily } from "api-server-api";
import type { ComponentType, SVGProps } from "react";

import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { BobFilledIcon, ClaudeIcon, CodexIcon, PiIcon } from "./brand-icons.js";

export const HARNESS_ICONS: Record<
  HarnessFamily,
  {
    label: string;
    Icon: ComponentType<SVGProps<SVGSVGElement>>;
    bg: string;
    iconClass?: string;
  }
> = {
  bob: {
    label: "Bob",
    Icon: BobFilledIcon,
    bg: "bg-icon-violet",
  },
  "claude-code": {
    label: "Claude",
    Icon: ClaudeIcon,
    bg: "bg-icon-clay",
    iconClass: "scale-110",
  },
  codex: {
    label: "Codex",
    Icon: CodexIcon,
    bg: "bg-icon-green",
    iconClass: "scale-90",
  },
  pi: {
    label: "Pi",
    Icon: PiIcon,
    bg: "bg-icon-blue",
  },
};

export function HarnessIcons({
  harnesses = ["bob", "claude-code", "codex", "pi"],
  size = "md",
  className,
}: {
  harnesses?: readonly string[];
  size?: "xs" | "sm" | "md";
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
              tabIndex={size === "xs" ? undefined : 0}
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
          return size === "xs" ? (
            icon
          ) : (
            <Tooltip key={name} content={label}>
              {icon}
            </Tooltip>
          );
        })}
    </span>
  );
}
