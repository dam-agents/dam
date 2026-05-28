/**
 * Dev-only floating toggle that opens the SetupChecklist's "all set"
 * celebratory state. Renders nothing in production builds. See ./README.md.
 */
import { Trophy } from "@carbon/icons-react";
import { lazy, Suspense, useState } from "react";

import { Button } from "@/components/ui/button";

const AllSetPreview = lazy(() =>
  import("./all-set-preview.js").then((m) => ({ default: m.AllSetPreview })),
);

export function AllSetPreviewToggle() {
  const [open, setOpen] = useState(false);

  // Dev-only design tool — never rendered in production builds.
  if (!import.meta.env.DEV) return null;

  return (
    <>
      <Button
        variant="secondary"
        size="icon"
        onClick={() => setOpen(true)}
        className="fixed bottom-40 md:bottom-28 right-4 z-[150] shadow-lg"
        aria-label="Preview checklist all-set state"
        title="All-set preview (dev only)"
      >
        <Trophy />
      </Button>
      {open && (
        <Suspense fallback={null}>
          <AllSetPreview onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
