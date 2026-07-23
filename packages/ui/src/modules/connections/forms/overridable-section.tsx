import type { ConnectionTemplateInput } from "api-server-api";
import { type Control, Controller, useWatch } from "react-hook-form";

import { Switch } from "@/components/ui/switch";

import type { TemplateFormValues } from "../lib/template-form-schema.js";
import { DisclosureBox } from "./disclosure-box.js";
import { labelFor } from "./field-copy.js";
import { TemplateFieldInput } from "./template-field-input.js";

export function OverridableSection({
  inputs,
  control,
  templateId,
  fromFamily,
}: {
  inputs: ConnectionTemplateInput[];
  control: Control<TemplateFormValues>;
  templateId: string;
  fromFamily?: boolean;
}) {
  const overriding = useWatch({ control, name: "overrideDefaults" });
  // A single toggle flips the whole overridable group: the fields only make
  // sense overridden together (your own app means all of its credentials, not
  // a mix of presets and custom values), so we don't expose them per-field.
  return (
    <DisclosureBox title="Customize defaults" testId="customize-defaults">
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <p className="text-[11px] text-muted-foreground">
            {fromFamily
              ? "Reused from another connection you've already set up. Leave off to share the same app, or turn on to use your own."
              : "These values are pre-configured by your administrator. Leave off to use the defaults, or turn on to supply your own."}
          </p>
          <Controller
            control={control}
            name="overrideDefaults"
            render={({ field }) => (
              <Switch
                checked={field.value}
                onCheckedChange={field.onChange}
                testId="override-defaults-toggle"
                label="Customize defaults"
              />
            )}
          />
        </div>
        {overriding ? (
          <div className="flex flex-col gap-3">
            {inputs.map((input) => (
              <TemplateFieldInput
                key={input.name}
                control={control}
                templateId={templateId}
                input={input}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {inputs.map((input) => (
              <PresetSummary key={input.name} input={input} />
            ))}
          </div>
        )}
      </div>
    </DisclosureBox>
  );
}

function PresetSummary({ input }: { input: ConnectionTemplateInput }) {
  if (input.presetValue)
    return (
      <p className="text-[11px] font-mono text-muted-foreground">
        {labelFor(input.name)}: {input.presetValue}
      </p>
    );
  if (input.secret)
    return (
      <p className="text-[11px] text-muted-foreground">
        {labelFor(input.name)}: preset value hidden.
      </p>
    );
  return null;
}
