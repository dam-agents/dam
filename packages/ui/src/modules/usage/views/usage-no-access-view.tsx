import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";

import { getUser, logout } from "../../../auth.js";
import { getBrand } from "../../../brand.js";
import { useStore } from "../../../store.js";

export function UsageNoAccessView() {
  const setView = useStore((s) => s.setView);
  const brand = getBrand().name;
  const email = getUser()?.profile.email ?? null;

  return (
    <div className="mx-auto w-full max-w-200 px-4 py-10">
      <Callout
        tone="gradient"
        className="flex flex-col items-start gap-3 p-6 anim-in"
      >
        <h2 className="text-base font-semibold text-foreground">
          We are sorry
        </h2>
        <p className="max-w-[520px] text-sm text-muted-foreground">
          This page shows the {brand} usage analytics report and is only for
          platform inspectors.
          {email ? (
            <>
              {" "}
              You are signed in as <strong>{email}</strong>.
            </>
          ) : null}
        </p>
        <div className="mt-1 flex flex-wrap gap-2">
          <Button onClick={() => setView("home")}>Go to {brand}</Button>
          <Button variant="outline" onClick={() => void logout()}>
            Switch account
          </Button>
        </div>
      </Callout>
    </div>
  );
}
