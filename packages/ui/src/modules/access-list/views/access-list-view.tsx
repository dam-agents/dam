import { PageHeader } from "@/components/ui/page-header";

import { getBrand } from "../../../brand.js";
import { AccessListSection } from "../components/access-list-section.js";

export function AccessListView() {
  return (
    <div>
      <PageHeader
        title="Access list"
        description={`The people who may sign in to ${getBrand().name}, by email address. Only platform operators see this page.`}
      />
      <AccessListSection />
    </div>
  );
}
