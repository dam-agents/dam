import { Renew } from "@carbon/icons-react";
import { type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";
import { DisclosureToggle } from "@/components/ui/disclosure";

interface Props {
  rawError: string;
  onRetry?: () => void;
  children?: ReactNode;
}

export function ErrorActions({ rawError, onRetry, children }: Props) {
  const [showRaw, setShowRaw] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {onRetry && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            data-testid="send-error-retry"
          >
            <Renew size={16} />
            Retry
          </Button>
        )}
        {children}
        <DisclosureToggle
          open={showRaw}
          onToggle={() => setShowRaw((open) => !open)}
          testId="send-error-raw-toggle"
          className="ml-auto gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          Raw error
        </DisclosureToggle>
      </div>
      {showRaw && (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-2 text-left font-mono text-xs text-muted-foreground">
          {rawError}
        </pre>
      )}
    </div>
  );
}
