import { useState } from "react";

import { CopyButton } from "@/components/ui/copy-button";

import { useAppVersion } from "../api/queries.js";

export function AppVersionRow() {
  const { data: version } = useAppVersion();
  const [copyUnavailable, setCopyUnavailable] = useState(false);

  if (!version) return null;

  return (
    <div className="mt-6">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <span className="break-all">Version {version}</span>
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
