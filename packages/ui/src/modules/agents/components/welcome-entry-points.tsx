import { Callout } from "@/components/ui/callout";

import { getBrand } from "../../../brand.js";
import { EntryPointButtons } from "./entry-point-buttons.js";

export function WelcomeEntryPoints() {
  const brand = getBrand().name;
  return (
    <Callout tone="muted" className="flex flex-col gap-4 py-8 anim-in">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        Welcome to {brand}
      </h1>
      <p className="max-w-[480px] text-sm text-foreground/80">
        {brand} runs agents in the cloud. Each one gets its own isolated
        environment, with your credentials and tools already set up.
      </p>
      <div>
        <EntryPointButtons surface="welcome" />
      </div>
    </Callout>
  );
}
