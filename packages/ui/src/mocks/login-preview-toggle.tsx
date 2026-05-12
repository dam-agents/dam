/**
 * Dev-only floating toggle that opens the login-page mockup. Renders nothing
 * when `VITE_USE_MOCKS` is off. See ./README.md.
 */
import {
  Login as LogIn,
} from "@carbon/icons-react";
import { lazy, Suspense, useState } from "react";

import { Button } from "@/components/ui/button";

const LoginPreview = lazy(() =>
  import("./login-preview.js").then((m) => ({ default: m.LoginPreview })),
);

export function LoginPreviewToggle() {
  const [open, setOpen] = useState(false);

  // Dev-only design tool — never rendered in production builds.
  if (!import.meta.env.DEV) return null;

  return (
    <>
      <Button
        variant="secondary"
        size="icon"
        onClick={() => setOpen(true)}
        className="fixed bottom-28 md:bottom-16 right-4 z-[150] shadow-lg"
        aria-label="Preview login page"
        title="Login mockup (dev only)"
      >
        <LogIn />
      </Button>
      {open && (
        <Suspense fallback={null}>
          <LoginPreview onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
