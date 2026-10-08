import { Warning } from "@carbon/icons-react";
import type { ReactNode } from "react";

interface Props {
  testId: string;
  children: ReactNode;
}

export function QuietNotice({ testId, children }: Props) {
  return (
    <p
      className="mt-1 flex max-w-[620px] items-start gap-1.5 text-xs text-muted-foreground break-words"
      data-testid={testId}
    >
      <Warning size={12} className="shrink-0 mt-0.5" />
      <span>{children}</span>
    </p>
  );
}
