import { Checkmark, WarningAlt, WarningFilled } from "@carbon/icons-react";
import type { ProviderKeyCheck } from "api-server-api";

import { Spinner } from "@/components/ui/spinner";
import { formatTimestamp } from "@/lib/format-time";

export function ProviderKeyStatus({
  check,
  checking,
}: {
  check: ProviderKeyCheck | null;
  checking?: boolean;
}) {
  if (checking) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Spinner size={12} className="text-muted-foreground" />
        Checking the key…
      </p>
    );
  }
  if (!check) return null;
  const at = formatTimestamp(check.checkedAt);
  switch (check.result) {
    case "ok":
      return (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Checkmark size={12} aria-hidden className="shrink-0 text-success" />
          Working right now
        </p>
      );
    case "refused":
      return (
        <p className="flex items-start gap-1.5 text-xs text-danger">
          <WarningFilled size={12} aria-hidden className="mt-0.5 shrink-0" />
          <span>
            Key refused on {at} ({check.detail}). Replace the key.
          </span>
        </p>
      );
    case "unverified":
      return (
        <p className="flex items-start gap-1.5 text-xs text-warning-fg">
          <WarningAlt size={12} aria-hidden className="mt-0.5 shrink-0" />
          <span>
            Could not verify the key on {at}: {check.detail}
          </span>
        </p>
      );
  }
}
