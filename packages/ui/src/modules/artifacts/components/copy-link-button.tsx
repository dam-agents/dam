import { Checkmark, Link, Warning } from "@carbon/icons-react";
import type { ComponentType } from "react";

import { Button } from "@/components/ui/button";
import type { CopyState } from "@/hooks/use-copy";
import { useCopy } from "@/hooks/use-copy";

const PRESENTATION: Record<
  CopyState,
  { label: string; Icon: ComponentType<{ size?: number }>; tone: string }
> = {
  idle: { label: "Copy link", Icon: Link, tone: "" },
  copied: {
    label: "Link copied",
    Icon: Checkmark,
    tone: "text-success hover:text-success",
  },
  failed: {
    label: "Couldn't copy",
    Icon: Warning,
    tone: "text-danger hover:text-danger",
  },
};

export function CopyLinkButton({
  url,
  variant,
}: {
  url: string;
  variant: "ghost" | "outline";
}) {
  const { copy, state } = useCopy();
  const { label, Icon, tone } = PRESENTATION[state];
  return (
    <>
      <Button
        variant={variant}
        size="xs"
        aria-label={label}
        className={tone}
        onClick={() => void copy(url)}
      >
        <Icon size={14} />
        <span className="hidden sm:inline">{label}</span>
      </Button>
      <span role="status" aria-live="polite" className="sr-only">
        {state === "idle" ? "" : label}
      </span>
    </>
  );
}
