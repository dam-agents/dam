import type { HarnessFamily } from "api-server-api";
import type { ComponentType, SVGProps } from "react";

import { cn } from "@/lib/utils";

import { BobFilledIcon, ClaudeIcon, CodexIcon, PiIcon } from "./brand-icons.js";

const ICONS: Record<
  HarnessFamily,
  {
    label: string;
    Icon: ComponentType<SVGProps<SVGSVGElement>>;
    bg: string;
    iconClass?: string;
  }
> = {
  bob: { label: "Bob", Icon: BobFilledIcon, bg: "bg-icon-blue" },
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
  pi: { label: "Pi", Icon: PiIcon, bg: "bg-icon-violet" },
};

export function HarnessIcons({
  harnesses = ["bob", "claude-code", "codex", "pi"],
  size = "md",
}: {
  harnesses?: readonly HarnessFamily[];
  size?: "sm" | "md";
}) {
  if (harnesses.length === 0) return null;
  return (
    <span className="flex items-center gap-2">
      {harnesses.map((name) => {
        const { Icon, label, bg, iconClass } = ICONS[name];
        return (
          <span
            key={name}
            role="img"
            aria-label={label}
            title={label}
            className={cn(
              "inline-flex shrink-0 items-center justify-center",
              size === "sm" ? "size-5" : ["size-7 rounded-lg text-white", bg],
            )}
          >
            <Icon
              aria-hidden="true"
              className={cn(size === "sm" ? "size-full" : "size-5", iconClass)}
            />
          </span>
        );
      })}
    </span>
  );
}
