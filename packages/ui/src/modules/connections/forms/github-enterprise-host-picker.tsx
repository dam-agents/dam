import { type Control, Controller } from "react-hook-form";

import { FormField } from "@/components/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

import { ANOTHER_HOST } from "../lib/github-enterprise-hosts.js";
import type { TemplateFormValues } from "../lib/template-form-schema.js";
import { GHE_HOST_CHOICE_HINT, placeholderFor } from "./field-copy.js";

export function GitHubEnterpriseHostPicker({
  control,
  hosts,
  anotherHost,
  onPick,
}: {
  control: Control<TemplateFormValues>;
  hosts: readonly string[];
  anotherHost: boolean;
  onPick: (host: string | typeof ANOTHER_HOST) => void;
}) {
  return (
    <Controller
      control={control}
      name="fields.host"
      render={({ field, fieldState }) => (
        <FormField
          label="Host"
          hint={
            anotherHost
              ? "A host this platform has no app on: sign in with your own GitHub app below."
              : GHE_HOST_CHOICE_HINT
          }
          error={fieldState.error?.message}
        >
          <div className="flex flex-col gap-2">
            <Select
              data-testid="connection-field-host"
              value={anotherHost ? ANOTHER_HOST : (field.value ?? "")}
              onChange={(e) => onPick(e.target.value)}
              onBlur={field.onBlur}
            >
              {hosts.map((host) => (
                <option key={host} value={host}>
                  {host}
                </option>
              ))}
              <option value={ANOTHER_HOST}>Another host…</option>
            </Select>
            {anotherHost && (
              <Input
                data-testid="connection-field-host-other"
                aria-label="Another host"
                placeholder={placeholderFor("github-enterprise", "host")}
                value={field.value ?? ""}
                onChange={(e) => field.onChange(e.target.value)}
                onBlur={field.onBlur}
              />
            )}
          </div>
        </FormField>
      )}
    />
  );
}
