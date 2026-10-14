import { SectionLabel } from "@/components/ui/section-label";
import { Switch } from "@/components/ui/switch";

export function ConnectionAddressingSetupSection({
  value,
  onChange,
  disabled,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <section className="mb-8">
      <SectionLabel spaced>Credential injection</SectionLabel>
      <label className="flex cursor-pointer items-start justify-between gap-4">
        <span>
          <span className="block text-sm font-medium text-foreground">
            Inject only into addressed requests
          </span>
          <span className="mt-0.5 block text-sm text-muted-foreground">
            Credentials go only into requests that name a connection; others are
            sent as-is. The browser panel needs it. Turn it off for an agent
            whose tools need credentials added to requests that name no
            connection.
          </span>
        </span>
        <Switch
          checked={value}
          onCheckedChange={onChange}
          disabled={disabled}
          label="Inject only into addressed requests"
        />
      </label>
    </section>
  );
}
