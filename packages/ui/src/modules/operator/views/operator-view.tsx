import { PageHeader } from "@/components/ui/page-header";

import { getBrand } from "../../../brand.js";
import { UserBudgetsSection } from "../../budgets/components/user-budgets-section.js";
import { SpendCeilingsSection } from "../../spend/components/spend-ceilings-section.js";

export function OperatorView() {
  return (
    <div>
      <PageHeader
        title="Operator"
        description={`Settings that apply to every user of ${getBrand().name}. Only platform operators see this page.`}
      />
      <SpendCeilingsSection />
      <UserBudgetsSection />
    </div>
  );
}
