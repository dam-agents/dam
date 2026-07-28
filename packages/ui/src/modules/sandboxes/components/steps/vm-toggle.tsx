import { Switch } from "@/components/ui/switch";

interface Props {
  vm: boolean;
  onChange: (vm: boolean) => void;
}

/** Step 1's VM switch — swaps the image catalogue between container-backed and
 *  VM-backed templates. Rendered only behind the vm-sandboxes feature flag. */
export function VmToggle({ vm, onChange }: Props) {
  return (
    <label className="mb-8 flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-border bg-card p-4">
      <span>
        <span className="block text-[14px] font-medium text-foreground">
          Run as a virtual machine
        </span>
        <span className="mt-0.5 block text-[13px] text-muted-foreground">
          A full VM instead of a container — systemd, docker and a k3s cluster
          inside the sandbox. Only images built as VM disks can boot this way,
          so the list below changes.
        </span>
      </span>
      <Switch checked={vm} onCheckedChange={onChange} />
    </label>
  );
}
