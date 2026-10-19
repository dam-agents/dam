import type { SpendLimitScope, SpendUnit } from "api-server-api";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { limitButtonLabel, limitButtonText } from "../lib/copy.js";
import { SpendLimitDialog } from "./spend-limit-dialog.js";

interface Props {
  scope: SpendLimitScope;
  subject: string;
  amountMicros: number | null;
  unit?: SpendUnit;
}

export function SpendLimitButton({
  scope,
  subject,
  amountMicros,
  unit = "usd",
}: Props) {
  const [open, setOpen] = useState(false);
  const hasLimit = amountMicros !== null;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0"
        aria-label={limitButtonLabel(hasLimit, subject)}
        onClick={() => setOpen(true)}
      >
        {limitButtonText(hasLimit)}
      </Button>
      {open && (
        <SpendLimitDialog
          scope={scope}
          unit={unit}
          subject={subject}
          amountMicros={amountMicros}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
