import { UserMultiple } from "@carbon/icons-react";

import { Badge } from "@/components/ui/badge";

export function SharedBadge() {
  return (
    <Badge variant="accent" className="gap-1" data-testid="agent-shared-badge">
      <UserMultiple size={12} />
      Shared
    </Badge>
  );
}
