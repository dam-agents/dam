import { Callout } from "@/components/ui/callout";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { useVmRuntime } from "../../features/hooks/use-vm-runtime.js";

export function VmRuntimeNotice({ className }: { className?: string }) {
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const vmRuntime = useVmRuntime();
  if (vmRuntime.unknown)
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        Could not read the sandbox runtime for this install, so this agent runs
        as a container.
      </p>
    );
  if (!vmRuntime.vm) return null;
  return (
    <Callout
      tone="info"
      inset
      className={cn("text-sm text-foreground", className)}
    >
      This agent runs as a microVM on the new sandbox runtime, enabled in{" "}
      <button
        type="button"
        className="font-medium underline"
        onClick={() => navigateToSettings("features")}
      >
        Experimental features
      </button>
      .
    </Callout>
  );
}
