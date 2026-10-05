import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/callout";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { useVmRuntime } from "../../features/hooks/use-vm-runtime.js";
import { VM_BACKEND_LABEL } from "../../starter-kits/lib/catalog-cards.js";

export function VmRuntimeNotice({
  className,
  vmOnly = false,
}: {
  className?: string;
  vmOnly?: boolean;
}) {
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const vmRuntime = useVmRuntime();
  if (vmOnly)
    return (
      <Callout
        tone="info"
        inset
        className={cn("text-sm text-foreground", className)}
      >
        <Badge variant="muted" size="sm" className="mr-2">
          {VM_BACKEND_LABEL}
        </Badge>
        This harness always runs as a microVM.
      </Callout>
    );
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
