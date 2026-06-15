import { ChevronDown, ChevronRight } from "@carbon/icons-react";
import { useState } from "react";
import type { FieldErrors, UseFormRegister } from "react-hook-form";

import { Input } from "@/components/ui/input";

import { FormField } from "../../../components/form-field.js";
import type { AddAgentValues } from "../forms/add-agent-schema.js";

interface Props {
  register: UseFormRegister<AddAgentValues>;
  errors: FieldErrors<AddAgentValues>["registryCredential"];
  onCollapse: () => void;
}

export function RegistryCredentialFields({
  register,
  errors,
  onCollapse,
}: Props) {
  const [open, setOpen] = useState(false);
  const Icon = open ? ChevronDown : ChevronRight;

  const toggle = () => {
    if (open) onCollapse();
    setOpen((v) => !v);
  };

  return (
    <fieldset className="flex flex-col gap-2">
      <button
        type="button"
        onClick={toggle}
        className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground uppercase tracking-[0.05em] hover:text-foreground"
      >
        <Icon size={12} />
        Private registry
      </button>
      {open && (
        <div className="flex flex-col gap-3">
          <p className="text-[12px] text-muted-foreground">
            Credentials to pull this image from a private registry. Stored with
            the agent and used only by the cluster to pull the image — never
            exposed to the agent.
          </p>
          <FormField label="Server" error={errors?.server?.message}>
            <Input
              placeholder="ghcr.io"
              {...register("registryCredential.server")}
            />
          </FormField>
          <FormField label="Username" error={errors?.username?.message}>
            <Input {...register("registryCredential.username")} />
          </FormField>
          <FormField label="Password" error={errors?.password?.message}>
            <Input
              type="password"
              placeholder="PAT, robot account, or access token"
              {...register("registryCredential.password")}
            />
          </FormField>
        </div>
      )}
    </fieldset>
  );
}
