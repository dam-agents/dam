import { type ReactNode, useState } from "react";

import { Collapse } from "@/components/ui/collapse";
import { DisclosureToggle } from "@/components/ui/disclosure";

/**
 * UNIT_BOUNDARY_DESCRIPTION: a panel that a bigger one holds, folded away until
 * it is asked for — the environment variables and the network rules inside
 * Services (D104), whose summary line answers the question without opening
 * them.
 */
export function FoldedSection({
  title,
  summary,
  defaultOpen = false,
  testId,
  children,
}: {
  title: string;
  summary?: string | undefined;
  defaultOpen?: boolean;
  testId?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="mb-8">
      <DisclosureToggle
        open={open}
        onToggle={() => setOpen(!open)}
        testId={testId}
        className="w-full rounded-md px-1 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/60"
      >
        <span>{title}</span>
        {summary && (
          <span className="ml-auto truncate text-sm font-normal text-muted-foreground">
            {summary}
          </span>
        )}
      </DisclosureToggle>
      <Collapse open={open}>
        <div className="pt-3">{children}</div>
      </Collapse>
    </section>
  );
}
