import { PageHeader } from "@/components/ui/page-header";

import { StarterKitCatalog } from "../components/browse-kits-modal.js";

export function StarterKitsView() {
  return (
    <>
      <PageHeader
        title="Starter kits"
        description="Pick a starter kit to create your agent from"
      />
      <StarterKitCatalog />
    </>
  );
}
