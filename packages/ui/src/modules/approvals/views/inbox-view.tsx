import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

import { useApprovalsForOwner } from "../api/queries.js";
import { ApprovalsList } from "../components/approvals-list.js";

const EMPTY: never[] = [];

export function InboxView() {
  const { data: rows = EMPTY, isLoading } = useApprovalsForOwner();
  const pendingCount = rows.filter((r) => r.status === "pending").length;
  return (
    <div>
      <PageHeader
        title="Inbox"
        adornment={
          <Badge variant="muted">
            {isLoading ? "loading…" : `${pendingCount} pending`}
          </Badge>
        }
        description="Decisions your agents are waiting on. Allowing permanently writes a network access rule for the agent so future requests of the same shape don't prompt again."
      />
      <Card className="overflow-hidden p-0">
        <ApprovalsList
          rows={rows}
          density="full"
          emptyLabel="Nothing pending"
        />
      </Card>
    </div>
  );
}
