/**
 * Dev-only floating toggle that opens the style guide overlay. Renders
 * nothing when `VITE_USE_MOCKS` is off. See ./README.md for removal.
 */
import {
  ColorPalette as Palette,
} from "@carbon/icons-react";
import { lazy, Suspense, useState } from "react";

import { Button } from "@/components/ui/button";

const StyleGuide = lazy(() => import("./style-guide.js").then((m) => ({ default: m.StyleGuide })));

export function StyleGuideToggle() {
  const [open, setOpen] = useState(false);

  // Dev-only design tool — never rendered in production builds.
  if (!import.meta.env.DEV) return null;

  return (
    <>
      <Button
        variant="secondary"
        size="icon"
        onClick={() => setOpen(true)}
        className="fixed bottom-16 md:bottom-4 right-4 z-[150] shadow-lg"
        aria-label="Open style guide"
        title="Style guide (dev only)"
      >
        <Palette />
      </Button>
      {open && (
        <Suspense fallback={null}>
          <StyleGuide onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
