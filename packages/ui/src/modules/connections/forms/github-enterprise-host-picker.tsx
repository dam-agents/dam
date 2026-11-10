import { type Control, Controller } from "react-hook-form";

import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

import { getBrand } from "../../../brand.js";
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
  onPick: (host: string) => void;
}) {
  const onlyHost = hosts.length === 1 ? hosts[0] : undefined;
  return (
    <Controller
      control={control}
      name="fields.host"
      render={({ field, fieldState }) => (
        <div className="flex flex-col gap-4">
          {onlyHost !== undefined ? (
            <FormField
              label="Host"
              hint={anotherHost ? undefined : GHE_HOST_CHOICE_HINT}
            >
              <div
                className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
                data-testid="connection-field-host"
              >
                <span className="font-medium text-foreground">
                  {anotherHost ? "Another host" : onlyHost}
                </span>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0"
                  onClick={() => onPick(anotherHost ? onlyHost : ANOTHER_HOST)}
                  data-testid="connection-host-switch"
                >
                  {anotherHost ? `Use ${onlyHost}` : "Use another host"}
                </Button>
              </div>
            </FormField>
          ) : (
            <FormField
              label="Host"
              hint={anotherHost ? undefined : GHE_HOST_CHOICE_HINT}
            >
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
            </FormField>
          )}
          {anotherHost && (
            <FormField
              label="Host name"
              hint={`A host ${getBrand().name} has no app on: sign in with your own GitHub app below.`}
              error={fieldState.error?.message}
            >
              <Input
                data-testid="connection-field-host-other"
                variant={fieldState.error ? "invalid" : undefined}
                placeholder={placeholderFor("github-enterprise", "host")}
                value={field.value ?? ""}
                onChange={(e) => field.onChange(e.target.value)}
                onBlur={field.onBlur}
              />
            </FormField>
          )}
        </div>
      )}
    />
  );
}
