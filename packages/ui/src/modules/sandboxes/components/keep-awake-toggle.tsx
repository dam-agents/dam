import { Switch } from "@/components/ui/switch";

const KEEP_AWAKE_LABEL = "Keep awake (never hibernate)";

// The keep-awake control row (label + description + Switch) used by the settings
// form; copy and testId live here. Callers own the surrounding layout and the
// (confirm-wrapped) change handler.
export function KeepAwakeToggle({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (on: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-[14px] font-medium text-foreground">
          {KEEP_AWAKE_LABEL}
        </p>
        <p className="text-[13px] text-muted-foreground">
          For long-running background workloads.
        </p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        label={KEEP_AWAKE_LABEL}
        testId="keep-awake-toggle"
      />
    </div>
  );
}
