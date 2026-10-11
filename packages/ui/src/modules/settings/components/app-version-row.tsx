import { useState } from "react";

import { CopyButton } from "@/components/ui/copy-button";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { useAppVersion } from "../api/queries.js";

const TAPS_TO_TOGGLE_FEATURES = 5;

export function AppVersionRow() {
  const { data: version } = useAppVersion();
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const featuresMenuRevealed = useStore((s) => s.featuresMenuRevealed);
  const setFeaturesMenuRevealed = useStore((s) => s.setFeaturesMenuRevealed);
  const [taps, setTaps] = useState(0);
  const [copyUnavailable, setCopyUnavailable] = useState(false);

  if (!version) return null;

  const onTap = () => {
    if (taps + 1 < TAPS_TO_TOGGLE_FEATURES) {
      setTaps(taps + 1);
      return;
    }
    setTaps(0);
    const revealed = !featuresMenuRevealed;
    setFeaturesMenuRevealed(revealed);
    navigateToSettings(revealed ? "features" : "account");
  };

  return (
    <div className="mt-6">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <span
          onClick={onTap}
          className={cn("break-all", !copyUnavailable && "select-none")}
        >
          Version {version}
        </span>
        <CopyButton
          value={version}
          label="Copy version"
          onResult={(state) => setCopyUnavailable(state === "failed")}
        />
      </div>
      {copyUnavailable && (
        <p className="mt-1.5 text-xs text-danger">
          Couldn&apos;t copy automatically — select the version and copy it
          manually.
        </p>
      )}
    </div>
  );
}
