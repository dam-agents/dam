import { Warning } from "@carbon/icons-react";
import type { ScanFailure } from "api-server-api";

import { Button } from "@/components/ui/button";
import { isConnectionFailure } from "@/lib/scan-failure";

export function SourceError({
  failure,
  onManageConnections,
}: {
  failure: ScanFailure;
  onManageConnections?: () => void;
}) {
  const canManage = onManageConnections && isConnectionFailure(failure);
  return (
    <div className="flex items-start gap-2 border-t border-border bg-danger-light px-4 py-3 text-sm text-danger">
      <Warning size={16} className="mt-px shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{failure.title}</p>
        <p className="text-muted-foreground">{failure.detail}</p>
      </div>
      {canManage && (
        <Button
          variant="link"
          size="inline"
          onClick={onManageConnections}
          className="shrink-0 font-semibold text-current underline hover:opacity-80"
        >
          Manage connections
        </Button>
      )}
    </div>
  );
}
