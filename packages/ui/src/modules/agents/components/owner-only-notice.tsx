import { Locked } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { Notice } from "@/components/ui/notice";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The notice at the top of a part of a Shared
 * Agent's page that only its owner changes: what only the owner does, why,
 * and who to ask. An Agent Editor reads it before they meet a control that is
 * not there, so they never wonder why.
 */
export function OwnerOnlyNotice({
  title,
  children,
  testId,
  className,
}: {
  title: string;
  children: ReactNode;
  testId: string;
  className?: string;
}) {
  return (
    <div data-testid={testId} className={className}>
      <Notice icon={Locked} title={title}>
        {children}
      </Notice>
    </div>
  );
}
