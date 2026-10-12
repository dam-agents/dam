import { PageEmptyState } from "@/components/ui/page-empty-state";

import { useStore } from "../../../store.js";

export function NotFoundView() {
  const setView = useStore((s) => s.setView);
  return (
    <PageEmptyState
      title="Page not found"
      message="This address does not match any page."
      actionLabel="Go to Home"
      onAction={() => setView("home")}
    />
  );
}
