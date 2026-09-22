import { Checkmark, Copy, Warning } from "@carbon/icons-react";
import type { ComponentType } from "react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { CopyState } from "@/hooks/use-copy";
import { useCopy } from "@/hooks/use-copy";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import {
  isFeaturesMenuRevealed,
  setFeaturesMenuRevealed,
} from "../../features/lib/menu-reveal.js";
import { useAppVersion } from "../api/queries.js";

const TAPS_TO_TOGGLE_FEATURES = 5;

const PRESENTATION: Record<
  CopyState,
  { label: string; Icon: ComponentType<{ size?: number }>; tone: string }
> = {
  idle: { label: "Copy version", Icon: Copy, tone: "" },
  copied: {
    label: "Version copied",
    Icon: Checkmark,
    tone: "text-success hover:text-success",
  },
  failed: {
    label: "Couldn't copy",
    Icon: Warning,
    tone: "text-danger hover:text-danger",
  },
};

export function AppVersionRow() {
  const { data: version } = useAppVersion();
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const [taps, setTaps] = useState(0);
  const { copy, state } = useCopy();

  if (!version) return null;

  const onTap = () => {
    if (taps + 1 < TAPS_TO_TOGGLE_FEATURES) {
      setTaps(taps + 1);
      return;
    }
    setTaps(0);
    const revealed = !isFeaturesMenuRevealed();
    setFeaturesMenuRevealed(revealed);
    navigateToSettings(revealed ? "features" : "account");
  };

  const { label, Icon, tone } = PRESENTATION[state];

  return (
    <div className="mt-6 flex items-center gap-1 text-xs text-muted-foreground">
      <span onClick={onTap} className="select-none break-all">
        Version {version}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={label}
        tooltip={label}
        className={cn("shrink-0", tone)}
        onClick={() => void copy(version)}
      >
        <Icon size={12} />
      </Button>
      <span role="status" aria-live="polite" className="sr-only">
        {state === "idle" ? "" : label}
      </span>
    </div>
  );
}
